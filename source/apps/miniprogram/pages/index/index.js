const store = require('../../storage/store');
const { parseChat, findNewMessages } = require('./parser');
const { parseScreenshot } = require('./screenshot-parser');
const api = require('../../services/api');
const { detect } = require('../../domain/charms');
const { score, GRADE, top, validate, quality } = require('../../domain/analysis');
const exporter = require('../../services/export');
const relations = [{ key:'new', label:'刚认识' },{ key:'crush', label:'Crush / 暧昧中' },{ key:'couple', label:'恋爱中' }];
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
function display(state, page = 'chat') {
  const c = store.active(state);
  const lines = c.analysis?.lines || {};
  const scoped = c.analysis?.scopeIds ? new Set(c.analysis.scopeIds) : null;
  const q = quality(scoped ? c.messages.filter(m=>scoped.has(m.id)) : c.messages, lines);
  const affinity = score(c.analysis?.overview?.affinity?.value);
  const charms = state.muted ? [] : detect(c.messages);
  return { page, title:c.title, activeId:c.id, draft:c.draft, relation:c.relation, relations,
    conversations:state.conversations.map(x=>({ id:x.id, title:x.title, count:x.messages.length, summary:x.messages.at(-1)?.text || '还没有记录' })),
    messages:c.messages.map(m=>({ ...m, own:m.sender==='self', unknown:m.sender==='unknown',
      label:m.sender==='other' ? top(lines[m.id]?.emotions,1)[0]?.name || '' : score(lines[m.id]?.score?.value)!==null ? GRADE(score(lines[m.id].score.value)) : '',
      rating:score(lines[m.id]?.score?.value), active:false })),
    affinity:affinity===null?'—':affinity, quality:q.value===null?'—':q.value, qualityCount:q.count,
    action:c.analysis?.overview?.action || '分析后查看', analysisStatus:c.analysis?.stale?'有新增待分析':c.analysis?'已分析':'还未分析',
    charms, muted:state.muted, reduceMotion:state.reduceMotion, hasDraft:!!c.draft.trim(), hasMessages:!!c.messages.length,
    canAnalyze:!c.analysis || c.analysis.stale || !!c.draft.trim(), scopeNote:c.analysis?.scopeIds?.length?`本次分析 ${c.analysis.scopeIds.length} 条记录`:'' ,
    tasks:c.tasks || [], detail:null, busy:false, status:'', exportMode:'standard', includeChat:true, includeAnalysis:true, anonymous:true };
}
function messageFromParsed(p, conversationId, batchId, source) {
  return { id:store.uid(), conversationId, sender:p.speaker==='我'?'self':p.speaker==='未分配'||p.speaker==='待确认'?'unknown':'other',
    speakerName:p.speaker, text:p.text, timestamp:p.timestamp||null, timestampRaw:p.timestamp||null, kind:'text', source, batchId };
}
Page({
  data: { ...display({ conversations:[store.conversation()], activeId:'', muted:false, reduceMotion:false }), exportRanges:['最近 20 条','最近 50 条','最近 120 条'] },
  onLoad() { try { this.state=store.load(); this.render('list'); this.resumeTasks(); } catch { wx.showModal({ title:'本机记录读取失败', content:'请不要清理小程序数据；稍后重新打开再试。', showCancel:false }); } },
  onShow() { if (this.state) this.resumeTasks(); },
  onHide() { if (this.state) this.flush(); },
  flush() { try { store.save(this.state); return true; } catch { this.setData({ status:'本机保存失败，请保留当前页面并腾出空间。' }); return false; } },
  render(page=this.data.page) { const previous={ busy:this.data.busy, status:this.data.status, detail:this.data.detail, exportMode:this.data.exportMode, includeChat:this.data.includeChat, includeAnalysis:this.data.includeAnalysis, anonymous:this.data.anonymous };
    this.setData({ ...display(this.state,page), ...previous }); },
  commit(next, page) { try { store.save(next); this.state=next; this.render(page); return true; } catch { this.setData({status:'本机保存失败，内容仍留在输入框；请腾出空间后重试。'}); return false; } },
  openList() { this.render('list'); },
  openConversation(e) { this.commit({ ...this.state, activeId:e.currentTarget.dataset.id },'chat'); },
  newConversation() { const c=store.conversation(); this.commit({ ...this.state, activeId:c.id, conversations:[c,...this.state.conversations] },'chat'); },
  onDraft(e) { const id=this.state.activeId; this.state=store.update(this.state,id,c=>({ ...c,draft:e.detail.value })); this.setData({draft:e.detail.value,hasDraft:!!e.detail.value.trim()}); clearTimeout(this.saveTimer); this.saveTimer=setTimeout(()=>this.flush(),500); },
  onDraftBlur() { this.flush(); },
  async archiveDraft() {
    const c=store.active(this.state), parsed=parseChat(c.draft); if (!parsed.length) return true;
    if(parsed.some(p=>p.speaker==='未分配'||p.speaker==='待确认')) { this.setData({status:'有待确认的发言人。请在文字前写“我：”或“对方：”后再分析。'}); return false; }
    const batchId=store.uid(); const incoming=parsed.map(p=>messageFromParsed(p,c.id,batchId,'paste'));
    let added=findNewMessages(c.messages,incoming);
    // A single repeated short phrase cannot be safely distinguished from an overlap.
    if(incoming.length===1 && !added.length && incoming[0].text.length<=4) {
      const append=await new Promise(resolve=>wx.showModal({title:'发现可能重复的短句',content:'这可能是再次粘贴，也可能是聊天里新说的一句。',confirmText:'作为新消息',cancelText:'跳过重合',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
      if(append) added=incoming;
    }
    if (!added.length) { this.commit(store.update(this.state,c.id,x=>({ ...x,draft:'' }))); return true; }
    return this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,x.messages.concat(added)),draft:'',
      batches:[...(x.batches||[]),{id:batchId,source:'paste',messageIds:added.map(m=>m.id),createdAt:Date.now()}] })));
  },
  undoLastBatch() { const c=store.active(this.state),batch=c.batches?.at(-1);if(!batch){this.setData({status:'没有可撤销的导入批次。'});return;}
    wx.showModal({title:'撤销最近一次导入',content:`将移除该批 ${batch.messageIds.length} 条消息和相关分析。`,success:r=>{if(!r.confirm)return;
      const removed=new Set(batch.messageIds);this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,x.messages.filter(m=>!removed.has(m.id))),
        batches:x.batches.slice(0,-1),analysis:null })));}}); },
  onRelation(e) { const relation=relations[Number(e.detail.value)]?.key; if (!relation) return; const c=store.active(this.state);
    this.commit(store.update(this.state,c.id,x=>({ ...x,relation,revision:x.revision+1,analysis:x.analysis?{ ...x.analysis,stale:true }:null }))); },
  openSettings() { this.render('settings'); },
  onTitle(e) { this.setData({title:e.detail.value}); },
  saveTitle() { const id=this.state.activeId,title=(this.data.title||'').trim()||'新的对话'; this.commit(store.update(this.state,id,c=>({ ...c,title }))); },
  clearDraft() { const id=this.state.activeId; this.commit(store.update(this.state,id,c=>({ ...c,draft:'' }))); },
  clearRecords() { const id=this.state.activeId; wx.showModal({title:'清空聊天记录',content:'这会删除此对象的聊天、分析和彩蛋；对象名称和草稿保留。',success:r=>{if(r.confirm)this.commit(store.update(this.state,id,c=>({ ...store.changeMessages(c,[]),analysis:null,tasks:[],batches:[] })));}}); },
  deleteConversation() { const id=this.state.activeId; wx.showModal({title:'删除聊天对象',content:'将删除此对象的草稿、记录、分析和识字任务，无法撤销。',success:r=>{if(!r.confirm)return; let conversations=this.state.conversations.filter(c=>c.id!==id); if(!conversations.length)conversations=[store.conversation()]; this.commit({ ...this.state,conversations,activeId:conversations[0].id },'list');}}); },
  onMute(e) { this.commit({ ...this.state,muted:e.detail.value }); },
  onMotion(e) { this.commit({ ...this.state,reduceMotion:e.detail.value }); },
  onMessageTap(e) { const c=store.active(this.state), id=e.currentTarget.dataset.id, m=c.messages.find(x=>x.id===id); if(!m)return;
    const line=c.analysis?.lines?.[id]; this.setData({ detail:{ kind:'message', id, text:m.text, title:m.speakerName, score:score(line?.score?.value), grade:score(line?.score?.value)!==null?GRADE(score(line.score.value)):'', emotions:top(line?.emotions),intents:top(line?.intents), evidenceId:id } }); this.render('detail'); },
  onMessageLong(e) { const id=e.currentTarget.dataset.id; wx.showActionSheet({itemList:['编辑正文','调整发言人','拆分消息','与下一条合并','删除此条'],success:r=>{
    if(r.tapIndex===0) this.editMessage(id); if(r.tapIndex===1)this.toggleSender(id);
    if(r.tapIndex===2)this.splitMessage(id); if(r.tapIndex===3)this.mergeNext(id);if(r.tapIndex===4)this.removeMessage(id);
  }}); },
  splitMessage(id) {const c=store.active(this.state),position=c.messages.findIndex(m=>m.id===id),m=c.messages[position];if(!m)return;
    wx.showModal({title:'拆分消息',content:'填写第一条结束处的字符序号（从 1 开始）。',editable:true,placeholderText:'例如 12',success:r=>{if(!r.confirm)return;
      const at=Number(r.content),characters=Array.from(m.text);if(!Number.isInteger(at)||at<1||at>=characters.length){this.setData({status:'拆分位置必须在消息正文中间。'});return;}
      const second={...m,id:store.uid(),text:characters.slice(at).join('').trim()};const first={...m,text:characters.slice(0,at).join('').trim()};
      if(!first.text||!second.text){this.setData({status:'拆分后两条都必须有文字。'});return;}
      this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,[...x.messages.slice(0,position),first,second,...x.messages.slice(position+1)]),analysis:null,
        batches:(x.batches||[]).map(b=>b.messageIds.includes(id)?{...b,messageIds:[...b.messageIds,second.id]}:b) })));
    }});
  },
  mergeNext(id) {const c=store.active(this.state),position=c.messages.findIndex(m=>m.id===id),a=c.messages[position],b=c.messages[position+1];
    if(!a||!b||a.sender!==b.sender||a.batchId!==b.batchId){this.setData({status:'只能合并同一导入批次里相邻且发言人相同的消息。'});return;}
    wx.showModal({title:'合并两条消息',content:'合并后相关分析将失效。',success:r=>{if(!r.confirm)return;
      this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,[...x.messages.slice(0,position),{...a,text:`${a.text}\n${b.text}`},...x.messages.slice(position+2)]),analysis:null,
        batches:(x.batches||[]).map(batch=>({...batch,messageIds:batch.messageIds.filter(mid=>mid!==b.id)})) })));
    }});
  },
  editMessage(id) { const c=store.active(this.state),m=c.messages.find(x=>x.id===id); if(!m)return;
    wx.showModal({title:'编辑消息',editable:true,placeholderText:'消息正文',content:m.text,success:r=>{if(r.confirm&&r.content?.trim())this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,x.messages.map(v=>v.id===id?{ ...v,text:r.content.trim() }:v)),analysis:null })));}}); },
  toggleSender(id) { const c=store.active(this.state);wx.showActionSheet({itemList:['我','对方'],success:r=>{const sender=r.tapIndex===0?'self':'other';this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,x.messages.map(m=>m.id===id?{ ...m,sender,speakerName:sender==='self'?'我':'对方' }:m)),analysis:null })));}}); },
  removeMessage(id) { const c=store.active(this.state);wx.showModal({title:'删除此条消息',content:'相关分析将失效。',success:r=>{if(r.confirm)this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,x.messages.filter(m=>m.id!==id)),analysis:null })));}}); },
  showOverview() { const c=store.active(this.state),o=c.analysis?.overview;this.setData({detail:{kind:'overview',title:'好感信号',text:'根据这段聊天的文字线索评分，不代表对方真实想法或喜欢你的概率。',evidenceId:o?.evidenceId,actionEvidenceId:o?.actionEvidenceId,action:o?.action||'',value:score(o?.affinity?.value),status:o?.affinity?.status||'' }});this.render('detail'); },
  showCharm(e) { const c=store.active(this.state),event=detect(c.messages).find(x=>x.key===e.currentTarget.dataset.key);if(!event)return;this.setData({detail:{kind:'charm',title:event.label,text:'这段聊天出现了对应话题。点击序号定位原句。',evidenceIds:event.evidenceIds,evidenceIndex:0,evidenceId:event.evidenceIds[0]}});this.render('detail'); },
  nextEvidence() {const d=this.data.detail;if(!d?.evidenceIds?.length)return;const evidenceIndex=(d.evidenceIndex+1)%d.evidenceIds.length;this.setData({detail:{...d,evidenceIndex,evidenceId:d.evidenceIds[evidenceIndex]}});},
  jumpEvidence() { const id=this.data.detail?.evidenceId;this.render('chat');if(id)this.setData({scrollTo:`msg-${id}`,highlightId:id}); },
  async chooseScreenshot() {
    if(this.data.busy)return;
    let files;try{const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:4,mediaType:['image'],sourceType:['album'],success:resolve,fail:reject}));files=result.tempFiles||[];}catch{return;}
    const conversationId=this.state.activeId;this.setData({busy:true,status:`准备识别 ${files.length} 张截图…`});let completed=0;
    for(let i=0;i<files.length;i++) {
      if(files[i].size>4*1024*1024){this.setData({status:`第 ${i+1} 张超过 4 MB，已跳过；此前结果已保留。`});continue;}
      let task;
      try{
        const info=await new Promise((resolve,reject)=>wx.getImageInfo({src:files[i].tempFilePath,success:resolve,fail:reject}));
        const code=await api.login();const uploaded=await api.upload(files[i].tempFilePath,code);
        task={ jobId:uploaded.jobId,jobToken:uploaded.jobToken||'',conversationId,imageIndex:i,batchId:store.uid(),status:'waiting',width:info.width,height:info.height,createdAt:Date.now() };
        if(!this.commit(store.update(this.state,conversationId,c=>({ ...c,tasks:[...(c.tasks||[]),task] }))))break;
        this.setData({status:`第 ${i+1} / ${files.length} 张正在识字…`});await this.finishTask(task);completed++;
      }catch(error){if(error.terminal&&task)this.removeTask(conversationId,task.jobId);this.setData({status:`第 ${i+1} 张失败：${error.message||error.errMsg||'网络错误'}。已完成 ${completed} 张；其余继续处理。`});}
    }
    this.setData({busy:false,status:`已完成 ${completed} / ${files.length} 张；请在文字区校对后分析。`});
  },
  async finishTask(task) {
    const result=await api.poll(task);let text='';let title='';let uncertain=0;
    try{if(!task.width||!task.height)throw new Error('旧任务缺少截图尺寸');const parsed=parseScreenshot(result.items,task.width,task.height);text=parsed.text;title=parsed.title;uncertain=parsed.uncertain;}catch{ text=(result.lines||result.items?.map(item=>item.text)||[]).map(line=>`待确认：${line}`).join('\n');uncertain=(result.lines||result.items||[]).length; }
    const current=this.state.conversations.find(c=>c.id===task.conversationId);if(!current)return;
    const next=store.update(this.state,task.conversationId,c=>({ ...c,title:c.title==='新的对话'&&title?title:c.title,
      draft:[c.draft.trim(),text.trim()].filter(Boolean).join('\n'),tasks:(c.tasks||[]).filter(x=>x.jobId!==task.jobId) }));
    this.commit(next);this.setData({status:uncertain?`识字完成；${uncertain} 行待确认。`:'识字完成，请核对文字与发言人。'});
  },
  removeTask(conversationId,jobId) { this.commit(store.update(this.state,conversationId,c=>({ ...c,tasks:(c.tasks||[]).filter(t=>t.jobId!==jobId) }))); },
  async resumeTasks() { if(!this.state||this.resuming)return;this.resuming=true;
    for(const c of this.state.conversations)for(const task of c.tasks||[]) {
      if(Date.now()-task.createdAt>10*60*1000){this.setData({status:'识字任务已过期，请重新选图。'});this.commit(store.update(this.state,c.id,x=>({ ...x,tasks:x.tasks.filter(t=>t.jobId!==task.jobId) })));continue;}
      try{await this.finishTask(task);}catch(error){if(error.terminal)this.removeTask(c.id,task.jobId);this.setData({status:error.terminal?`识字任务未完成：${error.message}。其他截图结果已保留，可重新选择此图。`:`识字任务查询暂时失败：${error.message||'网络错误'}。下次进入会继续查询。`});}
    }this.resuming=false;
  },
  retryTaskQuery() { this.resumeTasks(); },
  async runAnalysis() {
    if(this.data.busy)return;if(!await this.archiveDraft())return;
    const c=store.active(this.state), id=c.id, revision=c.revision;
    if(c.messages.some(m=>m.sender==='unknown')){this.setData({status:'有待确认的发言人。长按对应消息，选择“调整发言人”。'});return;}
    if(c.analysis&&!c.analysis.stale){this.setData({status:'已分析当前记录。新增消息后可以继续分析。'});return;}
    const messages=c.messages.filter(m=>m.sender!=='unknown').slice(-120).map(m=>({id:m.id,sender:m.sender,text:m.text,timestamp:m.timestamp||null,kind:m.kind||'text'}));
    if(!messages.length){this.setData({status:'请先添加可识别发言人的聊天记录。'});return;}
    if(messages.reduce((n,m)=>n+Array.from(m.text).length,0)>24000){this.setData({status:'最近 120 条仍超过 24000 字；请缩小记录范围。'});return;}
    this.setData({busy:true,status:'正在分析好感信号…'});
    const base={revision,relation:c.relation,messages};const lines={...(c.analysis?.lines||{})};let overview,contextHash;
    const jobs=[{task:'overview',targetIds:[]}];
    const other=messages.filter(m=>m.sender==='other'&&!lines[m.id]);for(let i=0;i<other.length;i+=20)jobs.push({task:'other_messages',targetIds:other.slice(i,i+20).map(m=>m.id)});
    messages.filter(m=>m.sender==='self'&&!lines[m.id]).forEach(m=>jobs.push({task:'self_message',targetIds:[m.id]}));
    try{
      for(let i=0;i<jobs.length;i++) {
        const job={...base,...jobs[i]};const result=validate(await api.analyze(job,`${id.replace(/[^\w-]/g,'')}-${revision}`),job);
        if(contextHash && contextHash!==result.contextHash)throw new Error('分析结果上下文不一致，已停止保存。');
        contextHash=result.contextHash;
        if(store.active(this.state).id!==id){} // Results remain bound to the original object.
        const current=this.state.conversations.find(x=>x.id===id);
        if(!current||current.revision!==revision)throw new Error('记录已修改，本轮旧结果不会覆盖新版本。');
        if(result.overview)overview=result.overview;
        (result.lines||[]).forEach(line=>{ lines[line.id]=line; });
        this.commit(store.update(this.state,id,x=>({ ...x,analysis:{revision,overview,lines:{...lines},scopeIds:messages.map(m=>m.id),stale:true,createdAt:Date.now()} })));
        this.setData({status:`正在分析：${i+1} / ${jobs.length} 组…`});
      }
      this.commit(store.update(this.state,id,x=>({ ...x,analysis:{revision,overview,lines,scopeIds:messages.map(m=>m.id),stale:false,createdAt:Date.now()} })));
      this.setData({status:'分析完成；点数值或消息标签查看依据。'});
    }catch(error){this.setData({status:error.message||'分析失败，请稍后重试。'});}finally{this.setData({busy:false});}
  },
  openExport() { this.setData({exportMode:'standard',includeChat:true,includeAnalysis:true,anonymous:true,exportCount:20,previewPath:''});this.render('export'); },
  setExportMode(e) {this.setData({exportMode:e.detail.value?'compatible':'standard'});},
  setIncludeChat(e) {this.setData({includeChat:e.detail.value});},
  setIncludeAnalysis(e) {this.setData({includeAnalysis:e.detail.value});},
  setAnonymous(e) {this.setData({anonymous:e.detail.value});},
  setExportCount(e) {this.setData({exportCount:[20,50,120][Number(e.detail.value)]||20,previewPath:''});},
  async exportImage() { try {
    if(!this.data.includeChat&&!this.data.includeAnalysis)throw new Error('请至少选择聊天或分析。');
    this.setData({busy:true,status:'正在生成预览…'});
    const previewPath=await exporter.generate(this,store.active(this.state),{
      includeChat:this.data.includeChat,includeAnalysis:this.data.includeAnalysis,
      anonymous:this.data.anonymous,compatible:this.data.exportMode==='compatible',count:this.data.exportCount||20 });
    this.setData({previewPath,status:'已生成预览，可保存到相册。'});
  }catch(error){this.setData({status:error.message||error.errMsg||'生成失败，请缩小范围重试。'});}finally{this.setData({busy:false});} },
  saveExport() {if(!this.data.previewPath)return;wx.saveImageToPhotosAlbum({filePath:this.data.previewPath,
    success:()=>this.setData({status:'已保存到相册。'}),fail:()=>this.setData({status:'相册权限未开启；预览仍在，可检查权限后再次保存。'})});},
});
