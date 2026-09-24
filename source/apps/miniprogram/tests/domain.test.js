const test=require('node:test');const assert=require('node:assert/strict');
const store=require('../storage/store');const {detect}=require('../domain/charms');const {validate,top,GRADE}=require('../domain/analysis');
function wxMemory(){const data=new Map();global.wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,structuredClone(v))};return data;}
test('migrates old messages without deleting the old copy and keeps a per-object draft',()=>{
 const data=wxMemory();data.set('crush_miniprogram_probe_v2',{activeId:'a',draft:'我：新消息',chats:[{id:'a',title:'A',messages:[{speaker:'我',text:'旧消息',timestamp:null}]},{id:'b',title:'B',messages:[]}]});
 const state=store.load();assert.equal(state.conversations[0].draft,'我：新消息');assert.equal(state.conversations[1].draft,'');assert.equal(state.conversations[0].messages[0].sender,'self');assert.ok(state.conversations[0].messages[0].id);assert.ok(data.has('crush_miniprogram_probe_v2'));
});
test('charms retain real evidence and do not trigger on unrelated single characters',()=>{
 const messages=[{id:'a',sender:'self',text:'风控和小红书'},{id:'b',sender:'other',text:'风控不错'}];
 const events=detect(messages);assert.equal(events.some(e=>e.key==='weather'||e.key==='book'),false);
 const moon=detect([{id:'c',sender:'self',text:'今晚的月亮真亮'}]).find(e=>e.key==='moon');assert.deepEqual(moon.evidenceIds,['c']);
});
test('analysis rejects foreign evidence and preserves small nonzero probabilities',()=>{
 const job={revision:3,messages:[{id:'a'}]};assert.throws(()=>validate({revision:3,contextHash:'x',overview:{affinity:{value:50},evidenceId:'foreign'}},job));
 assert.equal(top({开心:.004,难判断:.6})[1].percent,'<1%');assert.equal(GRADE(95),'SSS');
});
