// The WeChat OCR service returns text plus itemcoord in the original image's pixels.
// Use geometry only for rows we can classify; leave ambiguous rows for manual review.
const clock = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
const date = /^(?:(?:20\d{2}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?\s*)?(?:[01]?\d|2[0-3]):[0-5]\d$/;

function clean(value) {
  return String(value || '').replace(/[\uFFFD\uE000-\uF8FF\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim();
}

function parseScreenshot(items, imageWidth, imageHeight) {
  const width = Number(imageWidth), height = Number(imageHeight);
  if (!width || !height) return { text: '', title: '', uncertain: 0, unavailable: true };
  const positioned = (items || []).map((item) => {
    const p = item.itemcoord || item.box || {};
    return { text: clean(item.text), x: Number(p.x), y: Number(p.y), w: Number(p.width), h: Number(p.height) };
  }).filter(row => row.text && [row.x, row.y, row.w, row.h].every(Number.isFinite) && row.w > 0 && row.h > 0);
  if (!positioned.length) {
    const raw = (items || []).map(item => clean(item.text)).filter(value => value && !clock.test(value) && !/^\d+%$/.test(value));
    return {
      text: raw.map(value => `待确认：${value}`).join('\n'), title: '', uncertain: raw.length,
      unavailable: !raw.length, fallback: Boolean(raw.length),
    };
  }

  const header = positioned.filter(row => row.y >= height * .045 && row.y < height * .098 && row.text.length <= 18 &&
    Math.abs(row.x + row.w / 2 - width / 2) < width * .2 && !clock.test(row.text));
  const title = header.length ? header.sort((a, b) => Math.abs(a.x + a.w / 2 - width / 2) - Math.abs(b.x + b.w / 2 - width / 2))[0].text : '';
  // Relative bounds cover different image resolutions. Crop only system chrome,
  // and keep partial message bubbles at the top edge of the chat area.
  const rows = positioned.filter(row => row.y >= height * .098 && row.y + row.h <= height * .925)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const messages = [];
  let pendingTime = '';
  let uncertain = 0;
  for (const row of rows) {
    const value = row.text;
    if (!value) continue;
    const center = row.x + row.w / 2;
    if (date.test(value) && Math.abs(center - width / 2) < width * .18) { pendingTime = value; continue; }
    let speaker = '';
    if (row.x > width * .25 && row.x + row.w > width * .74) speaker = '我';
    else if (row.x < width * .24 && row.x + row.w < width * .88) speaker = title || '对方';
    if (!speaker) { uncertain++; speaker = '待确认'; }
    const prev = messages[messages.length - 1];
    const sameColumn = prev && Math.abs(prev.x - row.x) < width * .13;
    const closeLine = prev && row.y - (prev.y + prev.h) <= Math.max(prev.h, row.h) * .72;
    if (prev && prev.speaker === speaker && sameColumn && closeLine && !pendingTime) {
      prev.text += value;
      prev.y = row.y;
      prev.h = row.h;
    } else {
      messages.push({ speaker, text: value, time: pendingTime, x: row.x, y: row.y, h: row.h });
      pendingTime = '';
    }
  }
  return {
    title, uncertain, unavailable: false, fallback: false,
    text: messages.map(message => `${message.speaker}${message.time ? ` [${message.time}]` : ''}：${message.text}`).join('\n'),
  };
}

module.exports = { parseScreenshot };
