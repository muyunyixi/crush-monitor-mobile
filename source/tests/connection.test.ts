import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index';
import { requestAnalysis, validateConnection } from '../src/transport';
import type { AnalysisRequest } from '../shared/types';
const origin = 'https://muyunyixi.github.io';
test('拒绝未配置转发服务和官方直连地址', () => {
  assert.throws(() => validateConnection({endpoint:'',key:'test'}), /尚未连接/);
  assert.throws(() => validateConnection({endpoint:'https://api.typesafe.ai/v1/systemone',key:'test'}), /官方接口/);
  assert.throws(() => validateConnection({endpoint:'http://example.com',key:'test'}), /HTTPS/);
});
test('缺少转发服务时不发送聊天或密钥', async () => {
  let requests = 0;
  const old = globalThis.fetch;
  globalThis.fetch = async () => { requests++; return new Response('{}'); };
  try { await assert.rejects(requestAnalysis({} as AnalysisRequest, {endpoint:'',key:'test'},new AbortController().signal)); assert.equal(requests,0); }
  finally { globalThis.fetch = old; }
});
test('转发服务允许当前 Pages 的预检，拒绝其他来源', async () => {
  const res = await worker.fetch(new Request('https://worker.example/api/analyze',{method:'OPTIONS',headers:{Origin:origin}}),{ALLOWED_ORIGIN:origin});
  assert.equal(res.status,204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);
  assert.match(res.headers.get('Access-Control-Allow-Headers')!,/Authorization/);
  const bad = await worker.fetch(new Request('https://worker.example/api/analyze',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}}),{ALLOWED_ORIGIN:origin});
  assert.equal(bad.status,403);
});
test('转发服务错误响应也带跨域头，且不回显密钥', async () => {
  const res = await worker.fetch(new Request('https://worker.example/api/analyze',{method:'POST',headers:{Origin:origin}}),{ALLOWED_ORIGIN:origin});
  assert.equal(res.status,401);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);
  const invalid = await worker.fetch(new Request('https://worker.example/api/analyze',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test-private-key'},body:'invalid-json'}),{ALLOWED_ORIGIN:origin});
  assert.equal(invalid.status,400);
  assert.ok(!(await invalid.text()).includes('test-private-key'));
});
