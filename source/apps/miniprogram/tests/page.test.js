const test=require('node:test');const assert=require('node:assert/strict');
test('switching objects retains separate drafts, and appending touches only the original object',async()=>{
 const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v)),showModal:()=>{},showToast:()=>{}};
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
