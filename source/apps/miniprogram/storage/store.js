const KEY = 'crush_miniprogram_v3';
const LEGACY = 'crush_miniprogram_probe_v2';
const OLD_DRAFT = 'paste_probe_draft_v1';
const { normalizeSaved } = require('../pages/index/parser');
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
function conversation(title = '新的对话') {
  return { id: uid(), title, relation: 'new', messages: [], batches: [], draft: '', analysis: null, tasks: [], revision: 0, schemaVersion: 3, updatedAt: Date.now() };
}
function migrate(legacy) {
  if (legacy && Array.isArray(legacy.chats) && legacy.chats.length) {
    return legacy.chats.map(c => ({ ...conversation(c.title || '新的对话'), id: c.id || uid(), updatedAt: c.updatedAt || Date.now(),
      draft: c.id === legacy.activeId ? legacy.draft || '' : '',
      messages: normalizeSaved(c.messages || []).map(m => ({ ...m, id: m.id || uid(), sender: m.speaker === '我' ? 'self' : m.speaker === '未分配' || m.speaker === '待确认' ? 'unknown' : 'other', source: 'paste', kind: 'text', batchId: 'legacy' })) }));
  }
  const c = conversation(); c.draft = wx.getStorageSync(OLD_DRAFT) || ''; return [c];
}
function load() {
  const current = wx.getStorageSync(KEY);
  if (current && current.schemaVersion === 3 && Array.isArray(current.conversations) && current.conversations.length) return current;
  const legacy = wx.getStorageSync(LEGACY);
  const conversations = migrate(legacy);
  const state = { schemaVersion: 3, activeId: legacy?.activeId || conversations[0].id, conversations, muted: false, reduceMotion: false };
  // Keep the legacy key untouched until the new record has been written successfully.
  wx.setStorageSync(KEY, state);
  return state;
}
function save(state) { wx.setStorageSync(KEY, { ...state, schemaVersion: 3 }); }
function active(state) { return state.conversations.find(c => c.id === state.activeId) || state.conversations[0]; }
function update(state, id, fn) { return { ...state, conversations: state.conversations.map(c => c.id === id ? fn(c) : c) }; }
function changeMessages(c, messages) { return { ...c, messages, revision: c.revision + 1, analysis: c.analysis ? { ...c.analysis, stale: true } : null, updatedAt: Date.now() }; }
module.exports = { uid, conversation, load, save, active, update, changeMessages };
