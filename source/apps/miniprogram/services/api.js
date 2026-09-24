const BASE = 'https://crush-monitor-mobile-api.muyunyixi.cloud';
const login = () => new Promise((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error('微信登录失败。')), fail: reject }));
function request(path, options = {}) {
  return new Promise((resolve, reject) => wx.request({ url: BASE + path, timeout: 25000, ...options,
    success: r => { if (r.statusCode >= 200 && r.statusCode < 300) return resolve(r.data);
      const error = new Error(r.data?.error || `服务返回 ${r.statusCode}`);
      error.terminal = r.statusCode === 403 || r.statusCode === 410;
      reject(error); }, fail: reject }));
}
function upload(path, code) {
  return new Promise((resolve, reject) => wx.uploadFile({ url: BASE + '/api/mini/ocr-async', filePath: path, name: 'image', formData: { loginCode: code, taskVersion: '2' },
    success: r => { let data; try { data = JSON.parse(r.data); } catch { reject(new Error('服务器未返回有效任务。')); return; }
      r.statusCode === 200 && data.jobId ? resolve(data) : reject(new Error(data.error || `上传失败（${r.statusCode}）。`)); }, fail: reject }));
}
async function poll(task) {
  for (let i = 0; i < 26; i++) {
    await new Promise(r => setTimeout(r, 1800));
    const data = await request(`/api/mini/ocr-job?id=${encodeURIComponent(task.jobId)}`, { header: { 'X-Ocr-Task-Token': task.jobToken || '' }, timeout: 12000 });
    if (data.done) { if (data.status !== 200) { const error = new Error(data.result?.error || '识字失败。'); error.terminal = true; throw error; } return data.result; }
  }
  throw new Error('任务仍在处理。稍后打开小程序将继续查询。');
}
async function analyze(job, runId) { return request('/api/mini/analyze', { method: 'POST', header: { 'Content-Type': 'application/json' }, data: { job, runId, loginCode: await login() } }); }
module.exports = { BASE, login, request, upload, poll, analyze };
