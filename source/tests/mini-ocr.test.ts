import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMiniOcr } from '../worker/mini-ocr';

function request(loginCode: string) {
  const form = new FormData();
  form.append('loginCode', loginCode);
  form.append('image', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], 'chat.png', { type: 'image/png' }));
  return new Request('https://worker.example/api/mini/ocr', { method: 'POST', body: form });
}

test('OCR refuses missing server credentials and invalid mini login', async () => {
  assert.equal((await handleMiniOcr(request('abcde'), {}, async () => ({ allowed: true }))).status, 503);
  assert.equal((await handleMiniOcr(request('bad'), { WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'test' }, async () => ({ allowed: true }))).status, 401);
});

test('OCR checks one-time login, quota and returns text without sending credential to client', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('jscode2session')) return Response.json({ openid: 'bound-user' });
    if (url.includes('cgi-bin/token')) return Response.json({ access_token: 'private-access-token', expires_in: 7200 });
    if (url.includes('cv/ocr/comm')) return Response.json({ errcode: 0, items: [{ text: '第一句' }, { text: '第二句' }] });
    throw new Error('Unexpected network request');
  };
  try {
    const env = { WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'server-secret' };
    const denied = await handleMiniOcr(request('valid-code'), env, async (openid) => {
      assert.equal(openid, 'bound-user');
      return { allowed: false };
    });
    assert.equal(denied.status, 429);
    assert.equal(calls.length, 1);
    const allowed = await handleMiniOcr(request('second-code'), env, async () => ({ allowed: true }));
    assert.equal(allowed.status, 200);
    assert.deepEqual((await allowed.json()).lines, ['第一句', '第二句']);
    assert.equal(calls.some(url => url.includes('cv/ocr/comm')), true);
  } finally {
    globalThis.fetch = original;
  }
});

test('OCR upstream errors identify their stage without exposing credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('private upstream details'); };
  try {
    const response = await handleMiniOcr(request('valid-code'), {
      WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'private-value',
    }, async () => ({ allowed: true }));
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.match(body, /login\/UNKNOWN/);
    assert.doesNotMatch(body, /private-value|private upstream details/);
  } finally {
    globalThis.fetch = original;
  }
});
