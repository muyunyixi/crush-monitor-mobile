const store = require('../../storage/store');
const { parseChat, importOverlap } = require('./parser');
const { parseScreenshot } = require('./screenshot-parser');
const api = require('../../services/api');
const { detect } = require('../../domain/charms');
const { score, GRADE, top, validate, quality, selectScope } = require('../../domain/analysis');
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
    conversations:state.conversations.map(x=>({ id:x.id, title:x.title, count:x.messages.length, summary:x.messages.at(-1)?.text || '还没有记录', example:!!x.isExample,
      updatedLabel:new Date(x.updatedAt||Date.now()).toLocaleDateString('zh-CN') })),
    canCreateExample:state.conversations.every(x=>!x.messages.length&&!x.draft.trim()&&!x.isExample),
    messages:c.messages.map(m=>({ ...m, own:m.sender==='self', unknown:m.sender==='unknown',
      label:m.sender==='other' ? top(lines[m.id]?.emotions,1)[0]?.name || '' : score(lines[m.id]?.score?.value)!==null ? GRADE(score(lines[m.id].score.value)) : '',
      rating:score(lines[m.id]?.score?.value), active:false })),
    affinity:affinity===null?'—':affinity, quality:q.value===null?'—':q.value, qualityCount:q.count,
    action:c.analysis?.overview?.action || '分析后查看', analysisStatus:c.analysis?.stale?'记录已修改，旧结果待更新':c.analysis?'已分析':'还未分析',
    charms, charmPreview:charms.slice(0,1),moreCharms:Math.max(0,charms.length-1), muted:state.muted, reduceMotion:state.reduceMotion, hasDraft:!!c.draft.trim(), hasMessages:!!c.messages.length,
    canAnalyze:!c.analysis || c.analysis.stale || !!c.draft.trim(), scopeNote:c.analysis?.scopeIds?.length?`本次分析 ${c.analysis.scopeIds.length} 条记录`:'' ,
    scopeLabel:c.analysisScope?.mode==='custom'?`第 ${c.analysisScope.start}–${c.analysisScope.end} 条`:`最近 ${c.analysisScope?.count||120} 条`,
    tasks:c.tasks || [], detail:null, busy:false, status:'', exportMode:'standard', includeChat:true, includeAnalysis:true, anonymous:true };
}
function messageFromParsed(p, conversationId, batchId, source) {
  return { id:store.uid(), conversationId, sender:p.speaker==='我'?'self':p.speaker==='未分配'||p.speaker==='待确认'?'unknown':'other',
    speakerName:p.speaker, text:p.text, timestamp:p.timestamp||null, timestampRaw:p.timestamp||null, kind:'text', source, batchId };
}
Page({
  data: { ...display({ conversations:[store.conversation()], activeId:'', muted:false, reduceMotion:false }), quotaNote:'', exportRanges:['最近 20 条','最近 50 条','最近 120 条'] },
  onLoad() { try { this.state=store.load(); this.render('list'); this.resumeTasks(); } catch { wx.showModal({ title:'本机记录读取失败', content:'请不要清理小程序数据；稍后重新打开再试。', showCancel:false }); } },
  onShow() { if (this.state) {this.resumeTasks();if(this.data.page==='chat')this.refreshQuota();} },
  onHide() { clearTimeout(this.punctuationTimer);if (this.state) this.flush(); },
  flush() { try { store.save(this.state); return true; } catch { this.setData({ status:'本机保存失败，请保留当前页面并腾出空间。' }); return false; } },
  render(page=this.data.page) { const previous={ busy:this.data.busy, status:this.data.status, detail:this.data.detail, reviewItems:this.data.reviewItems||[], exportMode:this.data.exportMode, includeChat:this.data.includeChat, includeAnalysis:this.data.includeAnalysis, anonymous:this.data.anonymous, quotaNote:this.data.quotaNote||'', historyTop:this.data.historyTop||0, scrollTo:this.data.scrollTo||'', showReturnAnchor:!!this.data.showReturnAnchor, highlightId:this.data.highlightId||'' };
    const c=store.active(this.state);this.setData({ ...display(this.state,page), ...previous, failedScreenshotCount:this.failedScreenshots?.[c.id]?.length||0 }); },
  commit(next, page) { try { store.save(next); this.state=next; this.render(page); return true; } catch { this.setData({status:'本机保存失败，内容仍留在输入框；请腾出空间后重试。'}); return false; } },
  clearAnchor() { this.detailOrigin=null;this.historyScrollTop=0;clearTimeout(this.highlightTimer);this.setData({historyTop:0,scrollTo:'',showReturnAnchor:false,highlightId:'',status:''}); },
  openList() { this.clearAnchor();this.render('list'); },
  openConversation(e) { this.clearAnchor();if(this.commit({ ...this.state, activeId:e.currentTarget.dataset.id },'chat'))this.refreshQuota(); },
  newConversation() { wx.showModal({title:'新建聊天对象',content:'',editable:true,placeholderText:'输入名称（最多 40 字）',success:r=>{
    if(!r.confirm)return;const title=(r.content||'').trim().slice(0,40);
    if(!title){this.setData({status:'请先填写对象名称。'});return;}
    this.clearAnchor();const c=store.conversation(title);
    if(this.commit({ ...this.state, activeId:c.id, conversations:[c,...this.state.conversations] },'chat'))this.refreshQuota();
  }}); },
  createExample() { if(!this.state.conversations.every(x=>!x.messages.length&&!x.draft.trim()&&!x.isExample))return;
    const c=store.conversation('示例对话'),batchId=store.uid();
    c.isExample=true;c.messages=[messageFromParsed({speaker:'我',text:'周末天气怎么样？'},c.id,batchId,'example'),
      messageFromParsed({speaker:'对方',text:'看起来不错，可以出去走走。'},c.id,batchId,'example')];
    c.revision=1;c.batches=[{id:batchId,source:'example',messageIds:c.messages.map(m=>m.id),createdAt:Date.now()}];
    this.clearAnchor();if(this.commit({ ...this.state,activeId:c.id,conversations:[c,...this.state.conversations] },'chat'))this.refreshQuota();
  },
  async refreshQuota() { if(this.quotaLoading||typeof wx.request!=='function')return;
    this.quotaLoading=true;
    try {const q=await api.quota();if(Number.isInteger(q.remaining)&&Number.isInteger(q.limit))
      this.setData({quotaNote:`今日分析剩余 ${q.remaining} / ${q.limit} 次（UTC 日界）`});}
    catch{this.setData({quotaNote:'分析额度暂不可查询'});}finally{this.quotaLoading=false;}
  },
  onHistoryScroll(e) { this.historyScrollTop=e.detail.scrollTop;
    const compact=e.detail.scrollTop>120;if(compact!==!!this.data.compactSummary)this.setData({compactSummary:compact}); },
  rememberOrigin() { if(!this.detailOrigin||this.detailOrigin.conversationId!==this.state.activeId)
    this.detailOrigin={conversationId:this.state.activeId,top:this.historyScrollTop||0}; },
  onDraft(e) { const id=this.state.activeId; this.state=store.update(this.state,id,c=>({ ...c,draft:e.detail.value,pendingCorrections:null,ocrSegments:null,ocrPrefix:'',updatedAt:Date.now() })); this.setData({draft:e.detail.value,hasDraft:!!e.detail.value.trim()}); clearTimeout(this.saveTimer); this.saveTimer=setTimeout(()=>this.flush(),500); },
  onEditorFocus() { this.setData({keyboardOpen:true}); },
  async onDraftBlur() { this.setData({keyboardOpen:false});clearTimeout(this.saveTimer);if(!this.flush())return;
    const c=store.active(this.state);
    if(c.draftKind!=='ocr'&&!c.pendingCorrections&&c.draft.trim())await this.archiveDraft();
  },
  async archiveDraft() {
    if(this.archiveLock)return this.archiveLock;
    const work=this.archiveDraftOnce();this.archiveLock=work;
    try{return await work;}finally{if(this.archiveLock===work)this.archiveLock=null;}
  },
  async archiveDraftOnce() {
    const c=store.active(this.state), parsed=c.pendingCorrections?.rawDraft===c.draft?c.pendingCorrections.items:this.parseDraftWithSources(c);
    return this.archiveParsed(c,parsed);
  },
  parseDraftWithSources(c) {
    const segments=c.ocrSegments||[],raw=[c.ocrPrefix||'',...segments.map(s=>s.text)].filter(Boolean).join('\n');
    if(!segments.length||c.draft.trim()!==raw.trim())return parseChat(c.draft);
    return [...parseChat(c.ocrPrefix||'').map(p=>({...p,source:'paste'})),...segments.flatMap(s=>parseChat(s.text).map(p=>({...p,batchId:s.batchId,source:'ocr',imageOrder:s.imageIndex})))];
  },
  async archiveParsed(c,parsed) {
    if(!parsed.length)return true;
    if(parsed.some(p=>p.speaker==='未分配'||p.speaker==='待确认')) { this.setData({status:'有待确认的发言人。请在文字前写“我：”或“对方：”后再分析。'}); return false; }
    if(parsed.some(p=>!p.text?.trim())) {this.setData({status:'有空白消息，请校对或移除后再归档。'});return false;}
    const named=new Set(parsed.map(p=>p.speaker).filter(name=>name!=='我'&&name!=='对方'));
    if(named.size>1) {this.setData({status:'这段记录有多位具名发言人。请先在草稿里将参与分析的两位标成“我”和“对方”，其他消息暂不导入。'});return false;}
    const defaultBatchId=store.uid();const incoming=parsed.map(p=>({...messageFromParsed(p,c.id,p.batchId||defaultBatchId,p.source||c.draftKind||'paste'),imageOrder:p.imageOrder}));
    const groups=[];for(const m of incoming){const last=groups.at(-1);if(last?.id===m.batchId)last.messages.push(m);
      else groups.push({id:m.batchId,source:m.source,imageOrder:m.imageOrder,messages:[m]});}
    const added=[],batches=[];let skipped=0;
    for(const group of groups){
      const plan=importOverlap(c.messages.concat(added),group.messages);let next=plan.messages,overlapDecision=plan.overlap?'skipped':'none';
      if(plan.weak){
        const decision=await new Promise(resolve=>wx.showModal({title:'可能重复的消息',content:'新记录开头与已有记录末尾相同。你可以保留这句，或跳过重合后继续追加。',confirmText:'跳过重合',cancelText:'作为新消息',success:r=>resolve(r.confirm?'skip':'append'),fail:()=>resolve(null)}));
        if(!decision)return false;
        if(decision==='append'){next=group.messages;overlapDecision='append';}
      }
      if(overlapDecision==='skipped')skipped+=plan.overlap;
      if(next.length){added.push(...next);batches.push({id:group.id,source:group.source,imageOrder:group.imageOrder,messageIds:next.map(m=>m.id),overlapDecision,createdAt:Date.now()});}
    }
    const current=this.state.conversations.find(x=>x.id===c.id);
    if(current?.draft!==c.draft||current?.revision!==c.revision){this.setData({status:'草稿或记录已更新，请重新检查后再导入。'});return false;}
    if (!added.length) { const saved=this.commit(store.update(this.state,c.id,x=>({ ...x,draft:'',draftKind:'paste',pendingCorrections:null,ocrSegments:null,ocrPrefix:'' })));
      if(saved)this.setData({status:'重复记录已跳过，没有新增消息。'});return saved; }
    const saved=this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,x.messages.concat(added)),draft:'',draftKind:'paste',pendingCorrections:null,ocrSegments:null,ocrPrefix:'',
      batches:[...(x.batches||[]),...batches] })));
    if(saved)this.setData({status:`已追加 ${added.length} 条记录${skipped?`，跳过 ${skipped} 条重合`:''}。`});
    return saved;
  },
  openDraftReview() {const c=store.active(this.state);if(!c.draft.trim())return;
    const saved=c.pendingCorrections?.rawDraft===c.draft?c.pendingCorrections.items:null;
    const items=(saved||this.parseDraftWithSources(c).map(p=>({...p,speaker:p.speaker==='我'||p.speaker==='对方'?p.speaker:'待确认',originalSpeaker:p.speaker})))
      .map((p,index)=>({...p,reviewId:`review-${index}`,timestamp:p.timestamp||''}));
    if(!items.length){this.setData({status:'没有识别到可校对的消息，请先核对原始文字。'});return;}
    if(this.commit(store.update(this.state,c.id,x=>({...x,pendingCorrections:{rawDraft:c.draft,items}})),'review'))
      this.setData({reviewItems:items,reviewSpeakers:['我','对方','待确认']});
  },
  updateReviewItems(items) {const c=store.active(this.state);
    this.state=store.update(this.state,c.id,x=>({...x,pendingCorrections:{rawDraft:x.draft,items},updatedAt:Date.now()}));
    this.setData({reviewItems:items});clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.flush(),500);
  },
  onReviewSpeaker(e) {const index=Number(e.currentTarget.dataset.index),speaker=['我','对方','待确认'][Number(e.detail.value)];
    if(!speaker||!this.data.reviewItems[index])return;
    this.updateReviewItems(this.data.reviewItems.map((m,i)=>i===index?{...m,speaker}:m));this.flush();
  },
  onReviewText(e) {const index=Number(e.currentTarget.dataset.index);if(!this.data.reviewItems[index])return;
    this.updateReviewItems(this.data.reviewItems.map((m,i)=>i===index?{...m,text:e.detail.value}:m));
  },
  onReviewTime(e) {const index=Number(e.currentTarget.dataset.index);if(!this.data.reviewItems[index])return;
    this.updateReviewItems(this.data.reviewItems.map((m,i)=>i===index?{...m,timestamp:e.detail.value.slice(0,80)}:m));
  },
  onReviewAction(e) {const index=Number(e.currentTarget.dataset.index),items=this.data.reviewItems;
    if(!items[index])return;
    wx.showActionSheet({itemList:['在字符位置拆分','与下一条合并','移除此条'],success:r=>{
      if(r.tapIndex===2){this.updateReviewItems(items.filter((_,i)=>i!==index));this.flush();return;}
      if(r.tapIndex===1){const next=items[index+1];if(!next||next.speaker!==items[index].speaker){this.setData({status:'只能合并相邻且发言人相同的消息。'});return;}
        this.updateReviewItems([...items.slice(0,index),{...items[index],text:`${items[index].text}\n${next.text}`},...items.slice(index+2)]);this.flush();return;}
      wx.showModal({title:'拆分消息',content:'',editable:true,placeholderText:'输入第一条结束处的字符序号',success:choice=>{
        if(!choice.confirm)return;const chars=Array.from(items[index].text),at=Number(choice.content);
        if(!Number.isInteger(at)||at<1||at>=chars.length){this.setData({status:'拆分位置须在正文中间。'});return;}
        const left=chars.slice(0,at).join('').trim(),right=chars.slice(at).join('').trim();if(!left||!right)return;
        this.updateReviewItems([...items.slice(0,index),{...items[index],text:left},{...items[index],reviewId:store.uid(),text:right,timestamp:''},...items.slice(index+1)]);this.flush();
      }});
    }});
  },
  closeDraftReview() {this.flush();this.render('chat');},
  async saveDraftReview() {const c=store.active(this.state);
    if(c.pendingCorrections?.rawDraft!==c.draft){this.setData({status:'草稿内容已变化，请重新进入逐条校对。'});return;}
    const items=c.pendingCorrections.items;if(!items.length){this.setData({status:'请至少保留一条消息。'});return;}
    if(await this.archiveDraft())this.render('chat');
  },
  undoLastBatch() { const c=store.active(this.state),batch=c.batches?.at(-1);if(!batch){this.setData({status:'没有可撤销的导入批次。'});return;}
    wx.showModal({title:'撤销最近一次导入',content:`将移除${batch.source==='ocr'&&Number.isInteger(batch.imageOrder)?`第 ${batch.imageOrder+1} 张截图对应的`: '该批'} ${batch.messageIds.length} 条消息和相关分析。`,success:r=>{if(!r.confirm)return;
      const removed=new Set(batch.messageIds);this.commit(store.update(this.state,c.id,x=>({ ...store.changeMessages(x,x.messages.filter(m=>!removed.has(m.id))),
        batches:x.batches.slice(0,-1),analysis:null })));}}); },
  onRelation(e) { const relation=relations[Number(e.detail.value)]?.key; if (!relation) return; const c=store.active(this.state);
    this.commit(store.update(this.state,c.id,x=>({ ...x,relation,revision:x.revision+1,analysis:x.analysis?{ ...x.analysis,stale:true,reuseLines:false }:null }))); },
  openSettings() { this.render('settings'); },
  onTitle(e) { this.setData({title:e.detail.value}); },
  saveTitle() { const id=this.state.activeId,title=(this.data.title||'').trim()||'新的对话'; this.commit(store.update(this.state,id,c=>({ ...c,title }))); },
  clearDraft() { const id=this.state.activeId; this.commit(store.update(this.state,id,c=>({ ...c,draft:'',draftKind:'paste',pendingCorrections:null,ocrSegments:null,ocrPrefix:'' }))); },
  clearRecords() { const id=this.state.activeId; wx.showModal({title:'清空聊天记录',content:'这会删除此对象的聊天、分析和彩蛋；对象名称和草稿保留。',success:r=>{if(r.confirm)this.commit(store.update(this.state,id,c=>({ ...store.changeMessages(c,[]),analysis:null,tasks:[],batches:[] })));}}); },
  deleteConversation() { const id=this.state.activeId; wx.showModal({title:'删除聊天对象',content:'将删除此对象的草稿、记录、分析和识字任务，无法撤销。',success:r=>{if(!r.confirm)return; let conversations=this.state.conversations.filter(c=>c.id!==id); if(!conversations.length)conversations=[store.conversation()]; this.commit({ ...this.state,conversations,activeId:conversations[0].id },'list');}}); },
  onMute(e) { this.commit({ ...this.state,muted:e.detail.value }); },
  onMotion(e) { this.commit({ ...this.state,reduceMotion:e.detail.value }); },
  chooseAnalysisScope() { if(this.data.busy)return;
    const c=store.active(this.state);
    wx.showActionSheet({itemList:['最近 20 条','最近 50 条','最近 120 条','自选起止消息'],success:r=>{
      if(r.tapIndex<3){const count=[20,50,120][r.tapIndex];this.commit(store.update(this.state,c.id,x=>({ ...x,analysisScope:{mode:'recent',count},analysis:null })));return;}
      wx.showModal({title:`共 ${c.messages.length} 条，选择起止序号`,content:'',editable:true,placeholderText:'例如 2-15，最多 120 条',success:choice=>{
        if(!choice.confirm)return;
        const match=/^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/.exec(choice.content||'');
        const start=Number(match?.[1]),end=Number(match?.[2]);
        if(!match||start<1||end>c.messages.length||end<start||end-start>=120){this.setData({status:'请填写有效的起止序号，一次最多 120 条。'});return;}
        this.commit(store.update(this.state,c.id,x=>({ ...x,analysisScope:{mode:'custom',start,end},analysis:null })));
      }});
    }});
  },
  onMessageTap(e) { const c=store.active(this.state), id=e.currentTarget.dataset.id, m=c.messages.find(x=>x.id===id); if(!m)return;this.rememberOrigin();
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
  showOverview() { this.rememberOrigin();const c=store.active(this.state),o=c.analysis?.overview;this.setData({detail:{kind:'overview',title:'好感信号',text:'根据这段聊天的文字线索评分，不代表对方真实想法或喜欢你的概率。',evidenceId:o?.evidenceId,actionEvidenceId:o?.actionEvidenceId,action:o?.action||'',value:score(o?.affinity?.value),status:o?.affinity?.status||'',stale:!!c.analysis?.stale,canReanalyze:!!c.analysis }});this.render('detail'); },
  reAnalyze() { const c=store.active(this.state);if(!c.analysis)return;
    wx.showModal({title:'重新分析当前范围',content:'这会重新请求分析，可能消耗今日额度；旧结果将在新结果完成前保留。',confirmText:'重新分析',success:r=>{
      if(!r.confirm)return;
      if(this.commit(store.update(this.state,c.id,x=>({ ...x,analysis:{...x.analysis,stale:true,reuseLines:false} })),'chat'))this.runAnalysis();
    }});
  },
  showCharmList() { const c=store.active(this.state);if(this.state.muted)return;
    this.rememberOrigin();this.setData({detail:{kind:'charm-list',title:'对话里的细节',text:'这些提示只对应出现过的文字，不评价任何关系。',events:detect(c.messages)}});this.render('detail');
  },
  showCharm(e) { const c=store.active(this.state),event=detect(c.messages).find(x=>x.key===e.currentTarget.dataset.key);if(!event||this.state.muted)return;
    this.rememberOrigin();const confirmed=c.charmConfirmations?.[event.dedupeKey]===c.revision;
    this.setData({detail:{kind:'charm',charmKey:event.key,title:event.label,text:event.key==='followup'?(confirmed?'你已确认这两句说的是同一件事。':'两句都提到同一活动；请确认是否真的是同一件事。'):'这段聊天出现了对应话题。点序号可定位原句。',
      evidenceIds:event.evidenceIds,evidenceIndex:0,evidenceId:event.evidenceIds[0],phrase:event.phrase||'',followupKey:event.key==='followup'&&!confirmed?event.dedupeKey:''}});this.render('detail'); },
  confirmCharmFollowup() { const key=this.data.detail?.followupKey,c=store.active(this.state);if(!key)return;
    if(!detect(c.messages).some(event=>event.dedupeKey===key))return;
    if(this.commit(store.update(this.state,c.id,x=>({...x,charmConfirmations:{...x.charmConfirmations,[key]:x.revision}}))))
      this.setData({detail:{...this.data.detail,followupKey:'',text:'你已确认这两句说的是同一件事。'}});
  },
  onCharmDetailLong() {if(this.data.detail?.charmKey!=='laugh'||this.state.reduceMotion)return;
    clearTimeout(this.punctuationTimer);
    this.setData({detail:{...this.data.detail,punctuationMoment:true}});
    this.punctuationTimer=setTimeout(()=>{if(this.data.detail?.charmKey==='laugh')this.setData({detail:{...this.data.detail,punctuationMoment:false}});},450);
  },
  nextEvidence() {const d=this.data.detail;if(!d?.evidenceIds?.length)return;const evidenceIndex=(d.evidenceIndex+1)%d.evidenceIds.length;this.setData({detail:{...d,evidenceIndex,evidenceId:d.evidenceIds[evidenceIndex]}});},
  closeDetail() { this.returnToOrigin(); },
  returnToOrigin() { const top=this.detailOrigin?.conversationId===this.state.activeId?this.detailOrigin.top:0;
    this.detailOrigin=null;clearTimeout(this.highlightTimer);this.render('chat');
    this.setData({scrollTo:'',historyTop:top,showReturnAnchor:false,highlightId:''});this.historyScrollTop=top;
  },
  jumpEvidence() { const id=this.data.detail?.evidenceId,c=store.active(this.state);
    if(!id||!c.messages.some(m=>m.id===id)){this.setData({status:'原句已不在当前记录中。'});this.returnToOrigin();return;}
    this.rememberOrigin();this.render('chat');this.setData({scrollTo:'',historyTop:-1,showReturnAnchor:true,highlightId:this.state.reduceMotion?'':id});
    const jump=()=>this.setData({scrollTo:`msg-${id}`});if(wx.nextTick)wx.nextTick(jump);else jump();
    clearTimeout(this.highlightTimer);if(!this.state.reduceMotion)this.highlightTimer=setTimeout(()=>this.setData({highlightId:''}),700);
  },
  jumpActionEvidence() { const id=this.data.detail?.actionEvidenceId;if(!id)return;
    this.setData({detail:{...this.data.detail,evidenceId:id}});this.jumpEvidence();
  },
  async chooseScreenshot() {
    if(this.data.busy)return;
    let files;try{const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:4,mediaType:['image'],sourceType:['album'],success:resolve,fail:reject}));files=result.tempFiles||[];}catch{return;}
    if(files.length)await this.processScreenshots(files.map((file,index)=>({file,index:index+1})),this.state.activeId);
  },
  async retryFailedScreenshots() {
    if(this.data.busy)return;
    const conversationId=this.state.activeId,items=this.failedScreenshots?.[conversationId]||[];
    if(!items.length)return;
    this.failedScreenshots[conversationId]=[];
    await this.processScreenshots(items,conversationId);
  },
  async processScreenshots(items,conversationId) {
    this.setData({busy:true,status:`准备识别 ${items.length} 张截图…`});let completed=0,pending=0;
    const failures=[];
    for(const {file,index} of items) {
      if(file.size>4*1024*1024){failures.push({index,reason:'超过 4 MB，请压缩后重新选择'});continue;}
      let task;
      try{
        const info=await new Promise((resolve,reject)=>wx.getImageInfo({src:file.tempFilePath,success:resolve,fail:reject}));
        const code=await api.login();const uploaded=await api.upload(file.tempFilePath,code);
        task={ jobId:uploaded.jobId,jobToken:uploaded.jobToken||'',conversationId,imageIndex:index-1,batchId:store.uid(),status:'waiting',width:info.width,height:info.height,createdAt:Date.now() };
        if(!this.commit(store.update(this.state,conversationId,c=>({ ...c,tasks:[...(c.tasks||[]),task] }))))throw new Error('本机存储失败，请腾出空间后重试');
        this.setData({status:`第 ${index} 张正在识字…`});await this.finishTask(task);completed++;
      }catch(error){
        if(task&&!error.terminal&&this.state.conversations.find(c=>c.id===conversationId)?.tasks?.some(t=>t.jobId===task.jobId)){pending++;continue;}
        if(error.terminal&&task)this.removeTask(conversationId,task.jobId);
        failures.push({file,index,reason:error.message||error.errMsg||'网络错误'});
      }
    }
    this.failedScreenshots=this.failedScreenshots||{};
    this.failedScreenshots[conversationId]=[...(this.failedScreenshots[conversationId]||[]),...failures.filter(item=>item.file)];
    if(this.state.activeId===conversationId)this.setData({busy:false,failedScreenshotCount:this.failedScreenshots[conversationId].length,
      status:`已完成 ${completed} / ${items.length} 张${pending?`，${pending} 张仍在查询`:''}${failures.length?`；失败：${failures.map(f=>`第 ${f.index} 张${f.reason}`).join('；')}`:''}。${failures.length?'可重试失败项或重新选图。':'请在文字区校对后分析。'}`});
    else this.setData({busy:false});
  },
  async finishTask(task) {
    this.taskLocks=this.taskLocks||new Map();
    if(this.taskLocks.has(task.jobId))return this.taskLocks.get(task.jobId);
    const work=this.finishTaskOnce(task).finally(()=>this.taskLocks.delete(task.jobId));
    this.taskLocks.set(task.jobId,work);return work;
  },
  async finishTaskOnce(task) {
    const result=await api.poll(task);let text='';let title='';let uncertain=0;
    try{if(!task.width||!task.height)throw new Error('旧任务缺少截图尺寸');const parsed=parseScreenshot(result.items,task.width,task.height);text=parsed.text;title=parsed.title;uncertain=parsed.uncertain;}catch{ text=(result.lines||result.items?.map(item=>item.text)||[]).map(line=>`待确认：${line}`).join('\n');uncertain=(result.lines||result.items||[]).length; }
    if(!text.trim()){const error=new Error('没有识别出聊天文字，请重新选择清晰截图');error.terminal=true;throw error;}
    const current=this.state.conversations.find(c=>c.id===task.conversationId);if(!current?.tasks?.some(t=>t.jobId===task.jobId))return;
    const next=store.update(this.state,task.conversationId,c=>{
      const draft=[c.draft.trim(),text.trim()].filter(Boolean).join('\n');
      const batchId=task.batchId||store.uid();
      const previous=c.pendingCorrections?.rawDraft===c.draft?c.pendingCorrections.items:null;
      const appended=previous?parseChat(text).map((p,index)=>({...p,speaker:p.speaker==='我'||p.speaker==='对方'?p.speaker:'待确认',originalSpeaker:p.speaker,
        batchId,source:'ocr',imageOrder:task.imageIndex,reviewId:`review-${previous.length+index}`,timestamp:p.timestamp||''})):[];
      return { ...c,title:c.title==='新的对话'&&title?title:c.title,draft,draftKind:'ocr',
        pendingCorrections:previous?{rawDraft:draft,items:[...previous,...appended]}:null,
        ocrPrefix:c.ocrSegments?.length?c.ocrPrefix||'':c.draft.trim(),
        ocrSegments:[...(c.ocrSegments||[]),{batchId,imageIndex:task.imageIndex,text:text.trim()}],
        tasks:(c.tasks||[]).filter(x=>x.jobId!==task.jobId) };
    });
    if(!this.commit(next))throw new Error('本机存储失败，识字结果没有归档');
    if(this.data.page==='review'&&this.state.activeId===task.conversationId){
      const items=store.active(this.state).pendingCorrections?.items;if(items)this.setData({reviewItems:items});
    }
    if(this.state.activeId===task.conversationId)this.setData({status:uncertain?`识字完成；${uncertain} 行待确认。`:'识字完成，请核对文字与发言人。'});
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
    if(this.data.busy)return;
    if(store.active(this.state).pendingCorrections){this.openDraftReview();this.setData({status:'请先完成逐条校对，再分析。'});return;}
    if(!await this.archiveDraft())return;
    const c=store.active(this.state), id=c.id, revision=c.revision;
    if(c.analysis&&!c.analysis.stale){this.setData({status:'已分析当前记录。新增消息后可以继续分析。'});return;}
    let messages;
    try{messages=selectScope(c.messages,c.analysisScope).map(m=>({id:m.id,sender:m.sender,text:m.text,timestamp:m.timestamp||null,kind:m.kind||'text'}));}
    catch(error){this.setData({status:error.message});return;}
    if(!messages.length){this.setData({status:'请先添加可识别发言人的聊天记录。'});return;}
    if(messages.some(m=>m.sender==='unknown')){this.setData({status:'所选范围有待确认的发言人。长按对应消息，选择“调整发言人”。'});return;}
    this.setData({busy:true,status:'正在分析好感信号…'});
    const base={revision,relation:c.relation,messages};const lines={...(c.analysis?.reuseLines!==false?c.analysis?.lines||{}:{})};let overview,contextHash,model,rubricVersion;
    const jobs=[{task:'overview',targetIds:[]}];
    const other=messages.filter(m=>m.sender==='other'&&!lines[m.id]);for(let i=0;i<other.length;i+=20)jobs.push({task:'other_messages',targetIds:other.slice(i,i+20).map(m=>m.id)});
    messages.filter(m=>m.sender==='self'&&!lines[m.id]).forEach(m=>jobs.push({task:'self_message',targetIds:[m.id]}));
    try{
      for(let i=0;i<jobs.length;i++) {
        const job={...base,...jobs[i]};const result=validate(await api.analyze(job,`${id.replace(/[^\w-]/g,'')}-${revision}`),job);
        if(contextHash && contextHash!==result.contextHash)throw new Error('分析结果上下文不一致，已停止保存。');
        contextHash=result.contextHash;
        model=result.model;rubricVersion=result.rubricVersion;
        const current=this.state.conversations.find(x=>x.id===id);
        if(!current||current.revision!==revision)throw new Error('记录已修改，本轮旧结果不会覆盖新版本。');
        if(result.overview)overview=result.overview;
        (result.lines||[]).forEach(line=>{ lines[line.id]=line; });
        if(!this.commit(store.update(this.state,id,x=>({ ...x,analysis:{revision,overview,lines:{...lines},contextHash,model,rubricVersion,scopeIds:messages.map(m=>m.id),stale:true,createdAt:Date.now()} }))))throw new Error('本机保存失败；分析结果没有归档，请检查本机空间。');
        this.setData({status:`正在分析：${i+1} / ${jobs.length} 组…`});
      }
      if(!this.commit(store.update(this.state,id,x=>({ ...x,analysis:{revision,overview,lines,contextHash,model,rubricVersion,scopeIds:messages.map(m=>m.id),stale:false,createdAt:Date.now()} }))))throw new Error('本机保存失败；分析结果没有归档，请检查本机空间。');
      this.setData({status:'分析完成；点数值或消息标签查看依据。'});
    }catch(error){this.setData({status:error.message||'分析失败，请稍后重试。'});}finally{this.setData({busy:false});this.refreshQuota();}
  },
  openExport() { this.setData({exportMode:'standard',includeChat:true,includeAnalysis:true,anonymous:true,exportCount:20,previewPath:''});this.render('export'); },
  setExportMode(e) {this.setData({exportMode:e.detail.value?'compatible':'standard',previewPath:''});},
  setIncludeChat(e) {this.setData({includeChat:e.detail.value,previewPath:''});},
  setIncludeAnalysis(e) {this.setData({includeAnalysis:e.detail.value,previewPath:''});},
  setAnonymous(e) {this.setData({anonymous:e.detail.value,previewPath:''});},
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
