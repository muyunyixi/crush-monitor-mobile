const test=require('node:test');const assert=require('node:assert/strict');
test('switching objects retains separate drafts, and appending touches only the original object',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:options=>options.success({confirm:true,content:'新对象'}),showToast:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};
 const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};
 page.onLoad();page.newConversation();const first=page.state.activeId;
 page.onDraft({detail:{value:'我：第一段'}});page.flush();page.newConversation();const second=page.state.activeId;
 assert.notEqual(first,second);assert.equal(page.state.conversations.find(c=>c.id===first).draft,'我：第一段');
 page.onDraft({detail:{value:'对方：第二段'}});page.flush();page.openConversation({currentTarget:{dataset:{id:first}}});
 assert.equal(page.data.draft,'我：第一段');assert.equal(await page.archiveDraft(),true);
 assert.equal(page.state.conversations.find(c=>c.id===first).messages[0].text,'第一段');
 assert.equal(page.state.conversations.find(c=>c.id===second).draft,'对方：第二段');
});
test('splitting a batch keeps undo scoped to both derived messages',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:options=>options.success({confirm:true,content:'2'})};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();page.openConversation({currentTarget:{dataset:{id:page.state.activeId}}});
 page.onDraft({detail:{value:'我：你好朋友'}});await page.archiveDraft();const id=page.state.conversations[0].messages[0].id;
 page.splitMessage(id);assert.equal(page.state.conversations[0].messages.length,2);
 page.undoLastBatch();assert.equal(page.state.conversations[0].messages.length,0);
});
test('OCR result can be restored after a restart without the temporary image file',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 const id=page.state.activeId,task={jobId:'job-1',conversationId:id,width:375,height:800,imageIndex:0,createdAt:Date.now()};
 page.state.conversations[0].tasks=[task];page.flush();
 const api=require('../services/api'),oldPoll=api.poll;
 api.poll=async()=>({items:[{text:'你好',itemcoord:{x:270,y:220,width:60,height:22}}]});
 try{await page.finishTask(task);assert.match(page.state.conversations[0].draft,/我：你好/);assert.equal(page.state.conversations[0].tasks.length,0);}
 finally{api.poll=oldPoll;}
});
test('a pasted group chat stays in the draft until the two speakers are selected',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 page.onDraft({detail:{value:'小明：你好\n小红：你好\n小李：大家好'}});
 assert.equal(await page.archiveDraft(),false);
 assert.equal(page.state.conversations[0].messages.length,0);
 assert.match(page.state.conversations[0].draft,/小李/);
});
test('selected analysis range is saved and an evidence jump can return to the previous position',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:options=>options.success({confirm:true,content:'1-2'}),showActionSheet:options=>options.success({tapIndex:3}),nextTick:fn=>fn()};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();page.openConversation({currentTarget:{dataset:{id:page.state.activeId}}});
 page.onDraft({detail:{value:'我：第一句\n对方：第二句'}});await page.archiveDraft();page.chooseAnalysisScope();
 assert.deepEqual(page.state.conversations[0].analysisScope,{mode:'custom',start:1,end:2});
 page.onHistoryScroll({detail:{scrollTop:345}});const id=page.state.conversations[0].messages[0].id;
 page.onMessageTap({currentTarget:{dataset:{id}}});assert.equal(page.data.page,'detail');
 page.closeDetail();assert.equal(page.data.historyTop,345);assert.equal(page.data.showReturnAnchor,false);
 page.onMessageTap({currentTarget:{dataset:{id}}});page.jumpEvidence();assert.equal(page.data.scrollTo,`msg-${id}`);assert.equal(page.data.showReturnAnchor,true);
 page.returnToOrigin();assert.equal(page.data.historyTop,345);assert.equal(page.data.scrollTo,'');assert.equal(page.data.showReturnAnchor,false);
});
test('failed screenshot remains retryable while successful OCR text is preserved',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{},chooseMedia:options=>options.success({tempFiles:[{tempFilePath:'bad',size:42},{tempFilePath:'good',size:42}]}),getImageInfo:options=>options.success({width:375,height:800})};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();page.openConversation({currentTarget:{dataset:{id:page.state.activeId}}});
 const api=require('../services/api'),old={login:api.login,upload:api.upload,poll:api.poll};let fail=true;
 api.login=async()=> 'code';api.upload=async file=>{if(file==='bad'&&fail)throw new Error('上传中断');return {jobId:file,jobToken:'token'};};
 api.poll=async task=>({items:[{text:task.jobId,itemcoord:{x:260,y:210,width:70,height:22}}]});
 try{
  await page.chooseScreenshot();assert.match(page.data.status,/第 1 张上传中断/);assert.equal(page.data.failedScreenshotCount,1);
  assert.match(page.state.conversations[0].draft,/我：good/);assert.equal(page.state.conversations[0].tasks.length,0);
  fail=false;await page.retryFailedScreenshots();assert.equal(page.data.failedScreenshotCount,0);
  assert.match(page.state.conversations[0].draft,/我：bad/);assert.match(page.state.conversations[0].draft,/我：good/);
 }finally{Object.assign(api,old);}
});
test('two simultaneous queries for the same OCR task append only once',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 const task={jobId:'same-job',conversationId:page.state.activeId,width:375,height:800,createdAt:Date.now()};
 page.state.conversations[0].tasks=[task];page.flush();
 const api=require('../services/api'),oldPoll=api.poll;let calls=0;
 api.poll=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {items:[{text:'只一次',itemcoord:{x:260,y:210,width:70,height:22}}]};};
 try{await Promise.all([page.finishTask(task),page.finishTask(task)]);assert.equal(calls,1);assert.equal(page.state.conversations[0].draft,'我：只一次');}
 finally{api.poll=oldPoll;}
});
test('empty OCR output stays retryable and never erases the current draft',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{},getImageInfo:options=>options.success({width:375,height:800})};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 const id=page.state.activeId;page.onDraft({detail:{value:'我：已有校对文字'}});
 const api=require('../services/api'),old={login:api.login,upload:api.upload,poll:api.poll};
 api.login=async()=> 'code';api.upload=async()=>({jobId:'empty',jobToken:'token'});api.poll=async()=>({items:[]});
 try{await page.processScreenshots([{file:{tempFilePath:'empty',size:42},index:1}],id);
  assert.match(page.data.status,/没有识别出聊天文字/);assert.equal(page.data.failedScreenshotCount,1);
  assert.equal(page.state.conversations[0].draft,'我：已有校对文字');assert.equal(page.state.conversations[0].tasks.length,0);
 }finally{Object.assign(api,old);}
});
test('clear pasted text archives on blur but OCR draft waits for review',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 page.onDraft({detail:{value:'我：已经校对\n对方：收到'}});await page.onDraftBlur();
 assert.equal(page.state.conversations[0].messages.length,2);assert.equal(page.state.conversations[0].draft,'');
 page.state.conversations[0].draftKind='ocr';page.onDraft({detail:{value:'待确认：可能是聊天'}});
 await page.onDraftBlur();assert.equal(page.state.conversations[0].messages.length,2);
 assert.match(page.state.conversations[0].draft,/待确认/);
});
test('OCR review preserves edits across reopening and archives only after speaker confirmation',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 page.state.conversations[0].draft='待确认：第一条\n对方：第二条';page.state.conversations[0].draftKind='ocr';page.flush();
 page.openDraftReview();assert.equal(page.data.page,'review');assert.equal(page.data.reviewItems[0].speaker,'待确认');
 page.onReviewSpeaker({currentTarget:{dataset:{index:0}},detail:{value:0}});
 page.onReviewText({currentTarget:{dataset:{index:0}},detail:{value:'第一条已修正\n正文引用：仍属于同一条'}});page.closeDraftReview();
 page.openDraftReview();assert.equal(page.data.reviewItems[0].text,'第一条已修正\n正文引用：仍属于同一条');
 await page.saveDraftReview();assert.equal(page.data.page,'chat');
 assert.equal(page.state.conversations[0].messages[0].sender,'self');assert.equal(page.state.conversations[0].messages[0].source,'ocr');
 assert.equal(page.state.conversations[0].messages[0].text,'第一条已修正\n正文引用：仍属于同一条');assert.equal(page.state.conversations[0].draft,'');
});
test('changing relationship reruns previous line analysis and stale requests cannot overwrite an edit',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 const c=page.state.conversations[0];c.messages=[{id:'a',sender:'self',speakerName:'我',text:'看书吗',timestamp:null},{id:'b',sender:'other',speakerName:'对方',text:'好呀',timestamp:null}];
 c.analysis={revision:0,lines:{a:{score:{value:80}},b:{emotions:{开心:1}}},overview:{affinity:{value:70}},scopeIds:['a','b'],reuseLines:true,stale:false};
 page.onRelation({detail:{value:'1'}});const api=require('../services/api'),old=api.analyze,tasks=[];
 api.analyze=async job=>{tasks.push(job.task);return {revision:job.revision,contextHash:'same-context',model:'test-model',rubricVersion:'test-rubric',
  overview:job.task==='overview'?{affinity:{value:70}}:undefined,lines:job.targetIds.map(id=>({id,score:{value:70}}))};};
 try{await page.runAnalysis();assert.deepEqual(tasks,['overview','other_messages','self_message']);assert.equal(c.analysis.reuseLines,true);
  assert.equal(page.state.conversations[0].analysis.stale,false);
  let release;api.analyze=()=>new Promise(resolve=>{release=resolve;});
  page.state.conversations[0].analysis.stale=true;page.state.conversations[0].analysis.reuseLines=false;
  const pending=page.runAnalysis();await new Promise(resolve=>setTimeout(resolve,0));
  page.commit(require('../storage/store').update(page.state,c.id,x=>require('../storage/store').changeMessages(x,[{...x.messages[0],text:'改过的文字'},x.messages[1]])));
  release({revision:page.state.conversations[0].revision-1,contextHash:'old',overview:{affinity:{value:33}}});await pending;
  assert.equal(page.state.conversations[0].analysis.overview.affinity.value,70);
  assert.match(page.data.status,/记录已修改/);
 }finally{api.analyze=old;}
});
test('reviewing two screenshots keeps separate import batches so undo removes only the final image',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:options=>options.success({confirm:true})};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 const c=page.state.conversations[0],api=require('../services/api'),old=api.poll;
 api.poll=async task=>({items:[{text:task.batchId,itemcoord:{x:270,y:210,width:70,height:22}}]});
 try{
  for(const batchId of ['第一张','第二张']){
   const task={jobId:batchId,conversationId:c.id,batchId,imageIndex:batchId==='第一张'?0:1,width:375,height:800,createdAt:Date.now()};
   page.state.conversations[0].tasks.push(task);await page.finishTask(task);
  }
  page.openDraftReview();await page.saveDraftReview();
  assert.deepEqual(page.state.conversations[0].batches.map(b=>b.imageOrder),[0,1]);
  assert.equal(page.state.conversations[0].messages.length,2);
  page.undoLastBatch();assert.equal(page.state.conversations[0].messages.length,1);
  assert.equal(page.state.conversations[0].messages[0].text,'第一张');
 }finally{api.poll=old;}
});
test('a later OCR result preserves edits already made in the review screen',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{}};
 global.Page=definition=>{global.pageDefinition=definition;};const path=require.resolve('../pages/index/index');delete require.cache[path];require(path);
 const page={...global.pageDefinition,setData(values){this.data={...this.data,...values};}};page.onLoad();
 const c=page.state.conversations[0],api=require('../services/api'),old=api.poll;
 api.poll=async task=>({items:[{text:task.batchId,itemcoord:{x:270,y:210,width:70,height:22}}]});
 try{
  const first={jobId:'one',conversationId:c.id,batchId:'第一张',imageIndex:0,width:375,height:800,createdAt:Date.now()};
  const second={...first,jobId:'two',batchId:'第二张',imageIndex:1};
  page.state.conversations[0].tasks=[first,second];await page.finishTask(first);
  page.openDraftReview();page.onReviewText({currentTarget:{dataset:{index:0}},detail:{value:'人工修正的内容'}});
  await page.finishTask(second);
  assert.deepEqual(page.data.reviewItems.map(m=>m.text),['人工修正的内容','第二张']);
  await page.saveDraftReview();assert.deepEqual(page.state.conversations[0].messages.map(m=>m.text),['人工修正的内容','第二张']);
  assert.deepEqual(page.state.conversations[0].batches.map(b=>b.imageOrder),[0,1]);
 }finally{api.poll=old;}
});
