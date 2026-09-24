import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { UsageLimiter } from '../worker/index';
import type { WorkerEnv } from '../worker/index';

test('asynchronous OCR upload returns promptly, then exposes the completed result', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('jscode2session')) return Response.json({ openid: 'openid-1' });
    if (url.includes('cgi-bin/token')) return Response.json({ access_token: 'access-1', expires_in: 7200 });
    if (url.includes('cv/ocr/comm')) return Response.json({ errcode: 0,
      items: [{ text: '你好', itemcoord: { x: 30, y: 200, width: 80, height: 20 } }] });
    throw new Error('Unexpected upstream URL');
  };
  try {
    const objects = new Map<string, UsageLimiter>();
    const namespace = {
      idFromName: (name: string) => name,
      get: (id: unknown) => ({ fetch: (request: Request) => {
        const key = String(id);
        if (!objects.has(key)) {
          const values = new Map<string, unknown>();
          objects.set(key, new UsageLimiter({ storage: {
            get: async <T>(name: string) => values.get(name) as T | undefined,
            put: async (name: string, value: unknown) => { values.set(name, value); },
            delete: async (name: string) => values.delete(name),
            setAlarm: async () => {},
          } }));
        }
        return objects.get(key)!.fetch(request);
      } }),
    };
    const env = { WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'server-secret',
      ALLOWED_ORIGIN: 'https://example.com', USAGE_LIMITER: namespace } satisfies WorkerEnv;
    const form = new FormData();
    form.append('loginCode', 'valid-code');
    form.append('image', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], 'chat.png'));
    const tasks: Promise<unknown>[] = [];
    const response = await worker.fetch(new Request('https://example.com/api/mini/ocr-async', {
      method: 'POST', body: form,
    }), env, { waitUntil: promise => { tasks.push(promise); } });
    assert.equal(response.status, 200);
    const { jobId } = await response.json() as { jobId: string };
    assert.match(jobId, /^[0-9a-f-]{36}$/);
    await Promise.all(tasks);
    const result = await worker.fetch(new Request(`https://example.com/api/mini/ocr-job?id=${jobId}`), env);
    assert.equal(result.status, 200);
    const job = await result.json() as { done: boolean; status: number; result: { items: Array<{ itemcoord: { x: number } }> } };
    assert.equal(job.done, true);
    assert.equal(job.status, 200);
    assert.equal(job.result.items[0].itemcoord.x, 30);
  } finally { globalThis.fetch = original; }
});
