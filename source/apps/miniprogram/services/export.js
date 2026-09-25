const { score, GRADE } = require('../domain/analysis');
const WIDTH = 375, PAD = 16, MAX = 4096;
function wrap(ctx, text, width, compatible) {
  const output=[];
  for(const paragraph of String(text).split('\n')) {
    let line='';
    for(const ch of Array.from(paragraph)) {
      // Compatibility measures individual glyph advances rather than relying on combined-string width.
      const length = candidate => compatible ? Array.from(candidate).reduce((sum,c)=>sum+ctx.measureText(c).width,0) : ctx.measureText(candidate).width;
      if(line && length(line+ch)>width){output.push(line);line=ch;}else line+=ch;
    }
    output.push(line || ' ');
  }
  return output;
}
function oneLine(ctx,text,width,compatible) {
  const line=wrap(ctx,String(text||''),width,compatible)[0]||'';
  return line.length<String(text||'').length?`${line.slice(0,-1)}…`:line;
}
function paint(ctx, conversation, options) {
  const messages=options.includeChat?conversation.messages.slice(-options.count):[];
  const lines=conversation.analysis?.lines||{};
  const entries=[];ctx.setFontSize(15);
  for(const m of messages) {
    const wrapped=wrap(ctx,m.text,252,options.compatible);
    const height=34+wrapped.length*22+(options.includeAnalysis && score(lines[m.id]?.score?.value)!==null?22:0);
    entries.push({m,wrapped,height});
  }
  let height=130+entries.reduce((n,e)=>n+e.height+12,0)+(options.includeAnalysis?130:0);
  if(height>MAX) throw new Error('内容超过设备画布上限，请选择较少消息。');
  height=Math.max(240,Math.ceil(height));
  ctx.setFillStyle('#f5f5f2');ctx.fillRect(0,0,WIDTH,height);
  ctx.setFillStyle('#26332f');ctx.setFontSize(19);ctx.fillText(oneLine(ctx,options.anonymous?'聊天记录':conversation.title,WIDTH-2*PAD,options.compatible),PAD,36);
  ctx.setFillStyle('#718078');ctx.setFontSize(11);ctx.fillText('好感监控器 · 文字线索，仅供参考',PAD,58);
  let y=78;
  if(options.includeAnalysis){
    const affinity=score(conversation.analysis?.overview?.affinity?.value);
    ctx.setFillStyle('#fff');ctx.fillRect(PAD,y,WIDTH-2*PAD,108);
    ctx.setFillStyle('#356f5d');ctx.setFontSize(15);ctx.fillText(`好感信号 ${affinity===null?'—':affinity} /100`,PAD+14,y+31);
    ctx.setFillStyle('#718078');ctx.setFontSize(12);
    const summary=wrap(ctx,`下一步：${conversation.analysis?.overview?.action||'暂无分析'}`,WIDTH-2*PAD-28,options.compatible);
    ctx.fillText(summary[0]||'',PAD+14,y+59);
    if(summary[1])ctx.fillText(oneLine(ctx,summary.slice(1).join(''),WIDTH-2*PAD-28,options.compatible),PAD+14,y+78);
    if(conversation.analysis?.stale)ctx.fillText('记录已修改，结果待更新',PAD+14,y+98);
    y+=124;
  }
  for(const e of entries){
    const own=e.m.sender==='self',x=own?WIDTH-PAD-284:PAD;
    ctx.setFillStyle(own?'#e3f0e9':'#ffffff');ctx.fillRect(x,y,284,e.height);
    ctx.setFillStyle('#6c8278');ctx.setFontSize(11);ctx.fillText(own?'我':e.m.speakerName||'对方',x+12,y+17);
    ctx.setFillStyle('#26332f');ctx.setFontSize(15);
    for(let i=0;i<e.wrapped.length;i++)ctx.fillText(e.wrapped[i],x+12,y+41+i*22);
    if(options.includeAnalysis){const n=score(lines[e.m.id]?.score?.value);if(n!==null){ctx.setFillStyle('#356f5d');ctx.setFontSize(11);ctx.fillText(`回复评级 ${GRADE(n)} · ${n}`,x+12,y+e.height-8);}}
    y+=e.height+12;
  }
  ctx.setFillStyle('#809088');ctx.setFontSize(10);ctx.fillText('评分不代表对方的真实想法。',PAD,height-20);
  return height;
}
function generate(page, conversation, options) {
  const ctx=wx.createCanvasContext('poster',page);
  const height=paint(ctx,conversation,options);
  return new Promise((resolve,reject)=>{
    page.setData({exportHeight:height},()=>{
      // Canvas context created after dimensions settle to avoid a blank export on device.
      const draw=wx.createCanvasContext('poster',page);paint(draw,conversation,options);
      draw.draw(false,()=>wx.canvasToTempFilePath({canvasId:'poster',width:WIDTH,height,destWidth:WIDTH*2,destHeight:height*2,success:r=>resolve(r.tempFilePath),fail:reject},page));
    });
  });
}
module.exports={wrap,generate};
