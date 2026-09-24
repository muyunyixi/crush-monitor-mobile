import { APIError } from "@typesafe-ai/sdk";
import { analyze, requestSchema } from "../server/analysis";
import { handleMiniOcr } from "./mini-ocr";

type DurableStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete?(key: string): Promise<boolean>;
  setAlarm?(scheduledTime: number): Promise<void>;
};
type DurableState = { storage: DurableStorage };
type DurableStub = { fetch(request: Request): Promise<Response> };
type DurableNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableStub;
};
export type WorkerEnv = {
  ALLOWED_ORIGIN: string;
  TYPESAFE_API_KEY?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  USAGE_LIMITER?: DurableNamespace;
};
type UsageRecord = { date: string; runIds: string[] };
type OcrJob = { expires: number; done: boolean; status?: number; body?: unknown };

const FREE_DAILY_LIMIT = 10;

export class UsageLimiter {
  constructor(private state: DurableState) {}

  async alarm() { await this.state.storage.delete?.("ocrJob"); }

  async fetch(request: Request): Promise<Response> {
    const { date, runId, action, jobStatus, jobBody } = (await request.json()) as {
      date?: string;
      runId?: string;
      action?: string;
      jobStatus?: number;
      jobBody?: unknown;
    };
    if (action === "ocr-start") {
      if (!this.state.storage.setAlarm) return Response.json({ error: "OCR job alarms unavailable" }, { status: 503 });
      await this.state.storage.put("ocrJob", { expires: Date.now() + 10 * 60_000, done: false } satisfies OcrJob);
      await this.state.storage.setAlarm(Date.now() + 10 * 60_000);
      return Response.json({ ok: true });
    }
    if (action === "ocr-finish") {
      const job = await this.state.storage.get<OcrJob>("ocrJob");
      if (!job || job.expires < Date.now()) return Response.json({ error: "expired" }, { status: 410 });
      await this.state.storage.put("ocrJob", { ...job, done: true, status: jobStatus, body: jobBody } satisfies OcrJob);
      return Response.json({ ok: true });
    }
    if (action === "ocr-result") {
      const job = await this.state.storage.get<OcrJob>("ocrJob");
      if (!job || job.expires < Date.now()) return Response.json({ error: "识字结果已过期，请重新上传。" }, { status: 410 });
      return Response.json(job.done ? { done: true, status: job.status, result: job.body } : { done: false },
        { headers: { "Cache-Control": "no-store" } });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || ""))
      return Response.json({ allowed: false, remaining: 0 }, { status: 400 });

    let usage = await this.state.storage.get<UsageRecord>("usage");
    if (!usage || usage.date !== date) usage = { date: date!, runIds: [] };
    if (action === "status")
      return Response.json({ allowed: true, remaining: FREE_DAILY_LIMIT - usage.runIds.length });
    if (!runId || runId.length > 128)
      return Response.json({ allowed: false, remaining: 0 }, { status: 400 });
    if (usage.runIds.includes(runId))
      return Response.json({ allowed: true, remaining: FREE_DAILY_LIMIT - usage.runIds.length });
    if (usage.runIds.length >= FREE_DAILY_LIMIT)
      return Response.json({ allowed: false, remaining: 0 }, { status: 429 });

    usage.runIds.push(runId);
    await this.state.storage.put("usage", usage);
    return Response.json({ allowed: true, remaining: FREE_DAILY_LIMIT - usage.runIds.length });
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function reserveMiniOcr(env: WorkerEnv, openid: string) {
  if (!env.USAGE_LIMITER) return { allowed: false, unavailable: true };
  const userHash = await sha256(openid);
  const stub = env.USAGE_LIMITER.get(env.USAGE_LIMITER.idFromName(`miniocr:${userHash}`));
  const response = await stub.fetch(new Request("https://usage.internal/reserve", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), runId: crypto.randomUUID() }),
  }));
  return { allowed: response.ok, unavailable: response.status >= 500 };
}

async function reserveFreeUse(request: Request, env: WorkerEnv, runId: string) {
  if (!env.USAGE_LIMITER)
    return { allowed: false, remaining: 0, unavailable: true };
  const ipHash = await sha256(request.headers.get("CF-Connecting-IP") || "unknown");
  const stub = env.USAGE_LIMITER.get(env.USAGE_LIMITER.idFromName(ipHash));
  const response = await stub.fetch(
    new Request("https://usage.internal/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), runId }),
    }),
  );
  const data = (await response.json()) as { allowed?: boolean; remaining?: number };
  return {
    allowed: response.ok && data.allowed === true,
    remaining: Math.max(0, Number(data.remaining) || 0),
    unavailable: false,
  };
}

async function getFreeStatus(request: Request, env: WorkerEnv) {
  if (!env.USAGE_LIMITER) return { remaining: 0, unavailable: true };
  const ipHash = await sha256(request.headers.get("CF-Connecting-IP") || "unknown");
  const stub = env.USAGE_LIMITER.get(env.USAGE_LIMITER.idFromName(ipHash));
  const response = await stub.fetch(new Request("https://usage.internal/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), action: "status" }),
  }));
  const data = (await response.json()) as { remaining?: number };
  return { remaining: Math.max(0, Number(data.remaining) || 0), unavailable: !response.ok };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function jobRequest(action: string, extra: Record<string, unknown> = {}) {
  return new Request("https://usage.internal/ocr-job", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }) });
}

export default {
  async fetch(request: Request, env: WorkerEnv, context?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    // Diagnostic only: verify that wx.uploadFile reaches this Worker. Do not
    // read, store or forward the uploaded image; no OCR quota is consumed.
    if (request.method === "POST" && url.pathname === "/api/mini/upload-check")
      return Response.json({ ok: true, stage: "worker-reached" }, { headers: { "Cache-Control": "no-store" } });
    if (request.method === "POST" && url.pathname === "/api/mini/ocr-async") {
      if (!env.USAGE_LIMITER || !context) return Response.json({ error: "异步识字服务尚未部署。" }, { status: 503 });
      const size = Number(request.headers.get("Content-Length") || 0);
      if (size > 4 * 1024 * 1024 + 10_000) return Response.json({ error: "图片超过 4 MB。" }, { status: 413 });
      let form: FormData;
      try { form = await request.formData(); } catch { return Response.json({ error: "上传格式错误。" }, { status: 400 }); }
      const image = form.get("image");
      if (!(image instanceof File) || image.size > 4 * 1024 * 1024 || image.size < 8)
        return Response.json({ error: "请选择小于 4 MB 的截图。" }, { status: 400 });
      const jobId = crypto.randomUUID();
      const stub = env.USAGE_LIMITER.get(env.USAGE_LIMITER.idFromName(`miniocrjob:${jobId}`));
      const initialized = await stub.fetch(jobRequest("ocr-start"));
      if (!initialized.ok) return Response.json({ error: "无法创建识字任务。" }, { status: 503 });
      const prepared = new Request(request.url, { method: "POST", body: form });
      context.waitUntil((async () => {
        let status = 502;
        let body: unknown = { error: "识字服务暂时不可用。" };
        try {
          const result = await handleMiniOcr(prepared, env, openid => reserveMiniOcr(env, openid));
          status = result.status;
          body = await result.json();
        } catch { /* Public result contains no internal error details or credentials. */ }
        await stub.fetch(jobRequest("ocr-finish", { jobStatus: status, jobBody: body }));
      })());
      return Response.json({ jobId }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "GET" && url.pathname === "/api/mini/ocr-job") {
      const jobId = url.searchParams.get("id") || "";
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId)) return Response.json({}, { status: 400 });
      if (!env.USAGE_LIMITER) return Response.json({}, { status: 503 });
      const stub = env.USAGE_LIMITER.get(env.USAGE_LIMITER.idFromName(`miniocrjob:${jobId}`));
      return stub.fetch(jobRequest("ocr-result"));
    }
    // Mini Program requests have no browser Origin. A one-time wx.login code is
    // verified against our AppID before the OCR API is called.
    if (request.method === "POST" && url.pathname === "/api/mini/ocr")
      return handleMiniOcr(request, env, (openid) => reserveMiniOcr(env, openid));
    const origin = request.headers.get("Origin");
    const allowedOrigins = (env.ALLOWED_ORIGIN || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (!origin || !allowedOrigins.includes(origin))
      return new Response("Forbidden", { status: 403 });
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Analysis-Run",
      "Access-Control-Expose-Headers": "X-Free-Limit, X-Free-Remaining",
      Vary: "Origin",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    };
    if (request.method === "GET" && url.pathname === "/health")
      return json({ ok: true, service: "crush-monitor-api", freeDailyLimit: FREE_DAILY_LIMIT }, 200, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method === "GET" && url.pathname === "/api/quota") {
      const auth = request.headers.get("Authorization") || "";
      if (auth.startsWith("Bearer ") && auth.slice(7).trim())
        return json({ limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT, unlimited: true }, 200, headers);
      const quota = await getFreeStatus(request, env);
      if (quota.unavailable)
        return json({ error: "免费次数服务尚未部署。" }, 503, headers);
      headers["X-Free-Limit"] = String(FREE_DAILY_LIMIT);
      headers["X-Free-Remaining"] = String(quota.remaining);
      return json({ limit: FREE_DAILY_LIMIT, remaining: quota.remaining }, 200, headers);
    }
    if (request.method !== "POST" || url.pathname !== "/api/analyze")
      return json({}, 404, headers);

    try {
      const body = await request.text();
      if (body.length > 200000) return json({ error: "聊天过长" }, 413, headers);
      const input = requestSchema.safeParse(JSON.parse(body));
      if (!input.success)
        return json({ error: "聊天格式不正确或超出范围" }, 400, headers);

      const auth = request.headers.get("Authorization") || "";
      const personalKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      let key = personalKey;
      if (!personalKey) {
        const runId = (request.headers.get("X-Analysis-Run") || "").trim();
        if (!runId || runId.length > 128)
          return json({ error: "缺少分析批次编号，请刷新网页后重试。" }, 400, headers);
        if (!env.TYPESAFE_API_KEY)
          return json({ error: "免费分析服务尚未配置，请填写自己的 TypeSafe API Key。" }, 503, headers);
        const quota = await reserveFreeUse(request, env, runId);
        if (quota.unavailable)
          return json({ error: "免费次数服务尚未部署，请填写自己的 TypeSafe API Key。" }, 503, headers);
        headers["X-Free-Limit"] = String(FREE_DAILY_LIMIT);
        headers["X-Free-Remaining"] = String(quota.remaining);
        if (!quota.allowed)
          return json({ error: "今天的 10 次免费分析已用完。填写自己的 TypeSafe API Key 后可继续使用。" }, 429, headers);
        key = env.TYPESAFE_API_KEY;
      }

      const result = await analyze(input.data, request.signal, key);
      return json(result, 200, headers);
    } catch (error) {
      if (error instanceof SyntaxError)
        return json({ error: "请求不是有效 JSON" }, 400, headers);
      if (error instanceof APIError && [401, 403, 429].includes(error.status ?? 0)) {
        const status = error.status!;
        const message = status === 429
          ? "模型调用受限：请检查额度或稍后重试。"
          : "TypeSafe 拒绝了此密钥，请检查密钥及访问权限。";
        return json({ error: message }, status, headers);
      }
      return json({ error: "模型调用失败，请检查密钥、额度与网络后重试。" }, 502, headers);
    }
  },
};
