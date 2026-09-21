import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { UsageLimiter } from "../worker/index";
import { requestAnalysis, validateConnection } from "../src/transport";
import type { AnalysisRequest } from "../shared/types";

const origin = "https://muyunyixi.github.io";
const job: AnalysisRequest = {
  revision: 1,
  relation: "crush",
  task: "overview",
  targetIds: [],
  messages: [{ id: "m1", sender: "other", text: "你好", timestamp: null, kind: "text" }],
};

test("连接允许不填写个人 Key，但拒绝缺少服务或官方直连", () => {
  assert.doesNotThrow(() => validateConnection({ endpoint: "https://worker.example/api/analyze", key: "" }));
  assert.throws(() => validateConnection({ endpoint: "", key: "" }), /尚未连接/);
  assert.throws(() => validateConnection({ endpoint: "https://api.typesafe.ai/v1/systemone", key: "" }), /官方接口/);
  assert.throws(() => validateConnection({ endpoint: "http://example.com", key: "" }), /HTTPS/);
});

test("缺少转发服务时不会发送聊天", async () => {
  let requests = 0;
  const old = globalThis.fetch;
  globalThis.fetch = async () => { requests++; return new Response("{}"); };
  try {
    await assert.rejects(requestAnalysis(job, { endpoint: "", key: "" }, new AbortController().signal, "run-1"));
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = old;
  }
});

test("同一分析批次只扣一次，单日第 11 个批次被限制", async () => {
  const data = new Map<string, unknown>();
  const limiter = new UsageLimiter({
    storage: {
      get: async <T>(key: string) => data.get(key) as T | undefined,
      put: async <T>(key: string, value: T) => { data.set(key, value); },
    },
  });
  const reserve = (runId: string) => limiter.fetch(new Request("https://usage.internal", {
    method: "POST",
    body: JSON.stringify({ date: "2026-09-21", runId }),
  }));
  for (let i = 1; i <= 10; i++) assert.equal((await reserve(`run-${i}`)).status, 200);
  const duplicate = await reserve("run-1");
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).remaining, 0);
  assert.equal((await reserve("run-11")).status, 429);
});

test("Worker 允许 Pages 预检并声明分析批次请求头", async () => {
  const res = await worker.fetch(new Request("https://worker.example/api/analyze", {
    method: "OPTIONS",
    headers: { Origin: origin },
  }), { ALLOWED_ORIGIN: origin });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(res.headers.get("Access-Control-Allow-Headers")!, /X-Analysis-Run/);
  const bad = await worker.fetch(new Request("https://worker.example/api/analyze", {
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example" },
  }), { ALLOWED_ORIGIN: origin });
  assert.equal(bad.status, 403);
});

test("无个人 Key 时使用公共服务流程，未部署额度绑定会明确报错", async () => {
  const res = await worker.fetch(new Request("https://worker.example/api/analyze", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Analysis-Run": "run-1" },
    body: JSON.stringify(job),
  }), { ALLOWED_ORIGIN: origin, TYPESAFE_API_KEY: "server-secret" });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /免费次数服务尚未部署/);
});

test("错误响应带跨域头且不回显个人 Key", async () => {
  const res = await worker.fetch(new Request("https://worker.example/api/analyze", {
    method: "POST",
    headers: { Origin: origin, Authorization: "Bearer test-private-key" },
    body: "invalid-json",
  }), { ALLOWED_ORIGIN: origin });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
  assert.ok(!(await res.text()).includes("test-private-key"));
});
