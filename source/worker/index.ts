import { APIError } from "@typesafe-ai/sdk";
import { analyze, requestSchema } from "../server/analysis";

type DurableStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
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
  USAGE_LIMITER?: DurableNamespace;
};
type UsageRecord = { date: string; runIds: string[] };

const FREE_DAILY_LIMIT = 10;

export class UsageLimiter {
  constructor(private state: DurableState) {}

  async fetch(request: Request): Promise<Response> {
    const { date, runId } = (await request.json()) as {
      date?: string;
      runId?: string;
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !runId || runId.length > 128)
      return Response.json({ allowed: false, remaining: 0 }, { status: 400 });

    let usage = await this.state.storage.get<UsageRecord>("usage");
    if (!usage || usage.date !== date) usage = { date: date!, runIds: [] };
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

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN)
      return new Response("Forbidden", { status: 403 });
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Analysis-Run",
      "Access-Control-Expose-Headers": "X-Free-Limit, X-Free-Remaining",
      Vary: "Origin",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    };
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return json({ ok: true, service: "crush-monitor-api", freeDailyLimit: FREE_DAILY_LIMIT }, 200, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
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
