// Pure local rules. An event always points to existing messages; no relationship score is changed.
const rules = [
  ['imperial','御前频道',/朕|大皇帝|灵气复苏/,2],
  ['moon','月下信号',/月亮|月光|月色|星河|星星/,1],
  ['laugh','同频笑点',/哈{2,}|h{2,}/i,2],
  ['food','饭搭子频道',/吃饭|晚饭|午饭|早餐|奶茶|火锅|面条|好吃/,2],
  ['music','共享歌单',/音乐|歌单|听歌|唱歌|旋律|耳机/,2],
  ['pet','毛茸茸频道',/小猫|猫咪|小狗|狗狗|宠物|喵喵/,2],
  ['plan','未来便签',/下次|明天|周末|改天/,2],
  ['thanks','善意回声',/谢谢|辛苦|感谢|理解你/,2],
  ['book','书页之间',/看书|读书|读诗|小说|书籍|诗集/,2],
  ['game','双人副本',/游戏|开黑|副本|组队/,2],
  ['weather','同一片天气',/天气|下雨|晴天|下雪|刮风/,2],
];
function detect(messages) {
  const valid = messages.filter(m => m.sender !== 'unknown' && m.text && m.source !== 'uncorrected');
  const events = [];
  for (const [key,label,pattern,min] of rules) {
    const found = valid.filter(m => pattern.test(m.text));
    if (found.length >= min && (min === 1 || new Set(found.map(m => m.sender)).size === 2 || key === 'imperial'))
      events.push({ key, label, evidenceIds: found.slice(0,3).map(m => m.id), ruleVersion: 1 });
  }
  if (valid.length >= 6) {
    const switches = valid.slice(1).filter((m,i) => m.sender !== valid[i].sender).length;
    if (switches / (valid.length - 1) >= .8) events.push({ key:'rhythm', label:'你来我往', evidenceIds:valid.slice(0,6).map(m=>m.id), ruleVersion:1 });
  }
  if (valid.some(m => /(?:^|\D)(?:0?[0-4]):[0-5]\d/.test(m.timestamp || '')))
    events.push({ key:'night', label:'夜航记录', evidenceIds:valid.filter(m=>/(?:^|\D)(?:0?[0-4]):[0-5]\d/.test(m.timestamp || '')).slice(0,2).map(m=>m.id), ruleVersion:1 });
  const ignored = new Set(['我们','你们','他们','这个','那个','就是','可以','不是','什么','怎么','一个','一下','然后','但是','因为','所以','真的','觉得']);
  ['你好','好的','谢谢','哈哈','今天','明天','现在','没有','还有','感觉','知道','就是','就是这样'].forEach(p=>ignored.add(p));
  const phrases = sender => { const map = new Map(); valid.filter(m=>m.sender===sender).forEach(m=>{
    if(/^[>＞「『]|^转发|^引用/.test(m.text))return;
    const t=m.text.replace(/[\s，。！？、：；,.!?:;~～“”"'（）()\[\]]/g,'');
    for(let size=4;size>=2;size--) for(let i=0;i<=t.length-size;i++) { const p=t.slice(i,i+size); if(!ignored.has(p) && !/^(哈|啊|嗯|哦|哈h|hh)+$/i.test(p) && !map.has(p)) map.set(p,m.id); }
  });return map;};
  const a=phrases('self'),b=phrases('other');
  const phrase=[...a.keys()].filter(p=>b.has(p)).sort((x,y)=>y.length-x.length)[0];
  if(phrase) events.push({ key:'echo', label:`默契回声 · ${phrase}`, phrase, evidenceIds:[a.get(phrase),b.get(phrase)], ruleVersion:2 });
  const topics=['电影','散步','吃饭','咖啡','图书馆','展览','音乐会','游戏','打球','爬山'];
  for(let i=0;i<valid.length-1;i++){
    const first=valid[i],topic=topics.find(t=>first.text.includes(t));
    if(!topic||!/(下次|明天|周末|约好|说好)/.test(first.text))continue;
    const next=valid.slice(i+1).find(m=>m.text.includes(topic)&&/(看完|去了|走完|吃过|喝过|玩过|打完|爬完|做完|结束)/.test(m.text));
    if(next){events.push({key:'followup',label:'下回分解 · 有后文',topic,evidenceIds:[first.id,next.id],dedupeKey:`${first.id}:${next.id}`,ruleVersion:1});break;}
  }
  outer:for(let i=0;i<valid.length-7;i++)for(let j=i+7;j<valid.length;j++){
    const first=valid[i],last=valid[j],topic=topics.find(t=>first.text.includes(t)&&last.text.includes(t));
    if(!topic||!first.batchId||!last.batchId||first.sender===last.sender)continue;
    if(valid.slice(i+1,j).some(m=>m.text.includes(topic)))continue;
    if(new Set(valid.slice(i,j+1).map(m=>m.batchId)).size>2)continue;
    events.push({key:'returnTopic',label:'绕了一圈 · 话题回来了',topic,evidenceIds:[first.id,last.id],ruleVersion:1});break outer;
  }
  return events;
}
module.exports = { detect };
