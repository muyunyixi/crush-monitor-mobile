import { analyze, requestSchema } from '../server/analysis';
export default {
  async fetch(request: Request, env: { ALLOWED_ORIGIN: string }): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403 });
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Vary': 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/analyze') return new Response('{}', { status: 404, headers });
    const key = request.headers.get('Authorization')?.replace(/^Bearer /, '').trim();
    if (!key) return new Response(JSON.stringify({error:'缺少 API Key'}), {status:401,headers});
    try {
      const body = await request.text();
      if (body.length > 200000) return new Response(JSON.stringify({error:'聊天过长'}), {status:413,headers});
      const input = requestSchema.safeParse(JSON.parse(body));
      if (!input.success) return new Response(JSON.stringify({error:'聊天格式不正确或超出范围'}), {status:400,headers});
      const result = await analyze(input.data, request.signal, key);
      return new Response(JSON.stringify(result), {headers});
    } catch {
      return new Response(JSON.stringify({error:'模型调用失败，请检查密钥、额度与网络后重试。'}), {status:502,headers});
    }
  },
};
