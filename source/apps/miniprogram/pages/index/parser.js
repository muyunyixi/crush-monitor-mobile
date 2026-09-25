// Port of the web app's chat header rules for native WeChat copied text.
const time = '(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}\\s+)?\\d{1,2}:\\d{2}(?::\\d{2})?';
const header = new RegExp(`^(.{1,40}?)\\s+(${time})$`);
const bracket = new RegExp(`^\\[(${time})\\]\\s*(.{1,40}?)[：:]\\s*(.*)$`);
const nativeTime = /^\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}(?::\d{2})?$/;
const screenshotLine = /^(.{1,24}?) \[((?:(?:20\d{2}[-/.年])?\d{1,2}[-/.月]\d{1,2}日?\s*)?(?:[01]?\d|2[0-3]):[0-5]\d)\][：:]\s*(.*)$/;

function parseChat(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const nativeFormat = lines.some(line => nativeTime.test(line.trim()));
  const messages = [];
  let current;
  function push() {
    if (current && current.text.trim()) messages.push({ ...current, text: current.text.trim() });
    current = undefined;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] && lines[i + 1].trim();
    if (line.trim() && next && nativeTime.test(next)) {
      push();
      current = { speaker: line.trim(), timestamp: next, text: '' };
      i++;
      continue;
    }
    if (!line.trim()) { if (current && current.text) current.text += '\n'; continue; }
    const screenshot = line.match(screenshotLine);
    if (screenshot) { push(); current = { speaker: screenshot[1], timestamp: screenshot[2], text: screenshot[3] }; continue; }
    const b = line.match(bracket);
    const h = line.match(header);
    const inline = line.match(/^([^\s：:<>]{1,24})[：:]\s*(.*)$/);
    if (!nativeFormat && b) { push(); current = { speaker: b[2], timestamp: b[1], text: b[3] }; continue; }
    if (!nativeFormat && h) { push(); current = { speaker: h[1], timestamp: h[2], text: '' }; continue; }
    if (inline && !/^https?$/.test(inline[1]) && !/^\d+$/.test(inline[1])) {
      push(); current = { speaker: inline[1], timestamp: null, text: inline[2] }; continue;
    }
    if (!current || current.speaker === '未分配' && !nativeFormat) {
      push(); current = { speaker: '未分配', timestamp: null, text: line };
    } else current.text += (current.text ? '\n' : '') + line;
  }
  push();
  return messages;
}

function normalizeSaved(messages) {
  if (!messages.length || typeof messages[0] !== 'string') return messages;
  // v0.2 and v0.3 stored each pasted line separately. Reconstruct native
  // clipboard blocks once so old nicknames and timestamps disappear as rows.
  const raw = messages.join('\n');
  if (raw.split('\n').some(line => nativeTime.test(line.trim()))) return parseChat(raw);
  return messages.map(text => ({ speaker: '未分配', timestamp: null, text }));
}

function equal(a, b) {
  return a.speaker === b.speaker && a.text === b.text && (!a.timestamp || !b.timestamp || a.timestamp === b.timestamp);
}

function importOverlap(existing, incoming) {
  let overlap = 0;
  if (existing.length <= incoming.length && existing.every((message, i) => equal(message, incoming[i]))) overlap = existing.length;
  for (let overlap = Math.min(existing.length, incoming.length); overlap > 0; overlap--) {
    if (existing.slice(-overlap).every((message, i) => equal(message, incoming[i]))) {
      const matched=incoming.slice(0,overlap);
      return {messages:incoming.slice(overlap),overlap,weak:overlap===1&&!matched[0].timestamp};
    }
  }
  const matched=incoming.slice(0,overlap);
  return {messages:incoming.slice(overlap),overlap,weak:overlap===1&&!matched[0]?.timestamp};
}
function findNewMessages(existing,incoming) {return importOverlap(existing,incoming).messages;}

module.exports = { parseChat, normalizeSaved, findNewMessages, importOverlap };
