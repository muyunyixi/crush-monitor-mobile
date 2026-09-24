const GRADE = n => n >= 95 ? 'SSS' : n >= 90 ? 'SS' : n >= 80 ? 'S' : n >= 70 ? 'A' : n >= 60 ? 'B' : n >= 40 ? 'C' : 'D';
const score = value => Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
function top(dict, limit = 3) {
  return Object.entries(dict || {}).filter(([, p]) => Number.isFinite(p) && p >= 0 && p <= 1)
    .sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([name, p]) => ({ name, percent: p > 0 && p < .005 ? '<1%' : `${Math.round(p * 100)}%` }));
}
function validate(response, request) {
  if (!response || response.revision !== request.revision || typeof response.contextHash !== 'string') throw new Error('分析结果版本不匹配。');
  const ids = new Set(request.messages.map(m => m.id));
  if (response.overview) {
    if (score(response.overview.affinity?.value) === null && response.overview.affinity?.value !== null) throw new Error('好感信号数值异常。');
    for (const key of ['evidenceId', 'actionEvidenceId']) if (response.overview[key] && !ids.has(response.overview[key])) throw new Error('分析证据不在本次范围。');
  }
  if (response.lines && (!Array.isArray(response.lines) || response.lines.some(l => !ids.has(l.id) || l.score?.value !== null && score(l.score?.value) === null ||
    [l.emotions,l.intents,l.score?.probabilities].some(dict=>dict && Object.values(dict).some(p=>!Number.isFinite(p)||p<0||p>1))))) throw new Error('逐句结果异常。');
  return response;
}
function quality(messages, lines) {
  const values = messages.filter(m => m.sender === 'self').map(m => score(lines[m.id]?.score?.value)).filter(n => n !== null);
  return { value: values.length ? Math.round(values.reduce((a,b) => a+b, 0) / values.length) : null, count: values.length };
}
module.exports = { GRADE, score, top, validate, quality };
