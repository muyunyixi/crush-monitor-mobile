import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { UsageLimiter } from '../worker/index.ts';
import { verifyWorker } from './verify-worker.mjs';

test('release checks cover both frontends without using a login code or quota', async () => {
  const original = globalThis.fetch;
  const objects = new Map();
  const namespace = {
    idFromName: name => name,
    get: id => ({ fetch: request => {
      if (!objects.has(id)) {
        const values = new Map();
        objects.set(id, new UsageLimiter({ storage: {
          get: async key => values.get(key), put: async (key, value) => { values.set(key, value); },
        } }));
      }
      return objects.get(id).fetch(request);
    } }),
  };
  const env = { ALLOWED_ORIGIN: 'https://muyunyixi.github.io', WECHAT_APP_ID: 'wx-test',
    WECHAT_APP_SECRET: 'private', TYPESAFE_API_KEY: 'model-key', MINI_ANALYSIS_DAILY_LIMIT: '3', USAGE_LIMITER: namespace };
  globalThis.fetch = (input, init) => worker.fetch(new Request(input, init), env);
  try {
    await verifyWorker('https://web.example', 'https://mini.example');
    assert.equal(objects.size, 1); // web quota status only; no mini quota reservation
    delete env.MINI_ANALYSIS_DAILY_LIMIT;
    await assert.rejects(verifyWorker('https://web.example', 'https://mini.example'), /api\/mini\/quota: expected HTTP 401, received 503/);
  } finally { globalThis.fetch = original; }
});
