import type { AnalysisRequest, AnalysisResponse } from '../shared/types';
export type ConnectionConfig = { key: string; endpoint: string };
export function validateConnection(config: ConnectionConfig) {
  if (!config.endpoint.trim()) throw new Error('分析服务尚未连接。请在右上角设置中填写转发服务地址；TypeSafe 不支持网页直连。');
  let endpoint: URL;
  try { endpoint = new URL(config.endpoint); } catch { throw new Error('转发服务地址格式不正确。'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('转发服务必须使用不含账号密码的 HTTPS 地址。');
  if (endpoint.hostname === 'api.typesafe.ai') throw new Error('这里需要填写转发服务地址，不能填写 TypeSafe 官方接口。');
  return endpoint;
}
export type AnalysisResult = AnalysisResponse & { freeRemaining?: number };
export async function requestAnalysis(job: AnalysisRequest, config: ConnectionConfig, signal: AbortSignal, runId: string): Promise<AnalysisResult> {
  const endpoint = validateConnection(config);
  let response: Response;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Analysis-Run': runId,
    };
    if (config.key.trim()) headers.Authorization = `Bearer ${config.key.trim()}`;
    response = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify(job), signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    });
  } catch {
    if (signal.aborted) throw new Error('分析已停止。');
    throw new Error('无法连接转发服务或请求超时。请检查服务地址和服务端跨域配置。');
  }
  let data: any;
  try { data = await response.json(); } catch { throw new Error('转发服务未返回有效 JSON，请检查服务地址。'); }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `分析服务请求失败（${response.status}）`);
  if (!data || typeof data.contextHash !== 'string' || data.revision !== job.revision) throw new Error('转发服务返回格式不正确。');
  const remaining = Number(response.headers.get('X-Free-Remaining'));
  if (Number.isInteger(remaining) && remaining >= 0) data.freeRemaining = remaining;
  return data;
}
