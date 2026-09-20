import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { analyze, requestSchema } from "./analysis";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "160kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/api/health", (_req, res) =>
  res.json({
    configured: Boolean(process.env.TYPESAFE_API_KEY),
    model: "jev-1.13.0",
  }),
);
let calls = 0;
let windowAt = Date.now();
let active = 0;
const budgets = new Map<string, { count: number; at: number }>();
app.post("/api/analyze", async (req, res) => {
  const origin = req.headers.origin;
  if (
    origin &&
    origin !== `${req.protocol}://${req.headers.host}` &&
    !["http://127.0.0.1:5178", "http://localhost:5178"].includes(origin)
  ) {
    res.status(403).json({ error: "请求来源不允许" });
    return;
  }
  const valid = requestSchema.safeParse(req.body);
  if (!valid.success) {
    res.status(400).json({ error: "聊天结构或长度不符合要求，请校正后重试" });
    return;
  }
  if (!process.env.TYPESAFE_API_KEY) {
    res
      .status(503)
      .json({ error: "分析服务尚未配置，请在服务端设置 TYPESAFE_API_KEY" });
    return;
  }
  const now = Date.now();
  if (now - windowAt > 3600000) {
    calls = 0;
    windowAt = now;
    budgets.clear();
  }
  const key = req.ip || "local";
  let entry = budgets.get(key);
  if (!entry || now - entry.at > 60000) {
    entry = { count: 0, at: now };
    budgets.set(key, entry);
  }
  if (entry.count >= 180 || calls >= 3000 || active >= 8) {
    res.status(429).json({ error: "分析请求较多，请稍后重试" });
    return;
  }
  entry.count++;
  calls++;
  active++;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    res.json(await analyze(valid.data, controller.signal));
  } catch (error) {
    const code = Number((error as { status?: number }).status) || 502;
    const messages: Record<number, string> = {
      401: "Jev 认证失败，请检查服务端 API 配置",
      403: "当前 API 账号没有调用权限",
      422: "模型无法处理当前输入，请缩小聊天范围重试",
      429: "Jev 正忙，请稍后重试",
      529: "Jev 暂时繁忙，请重试",
    };
    if (!res.headersSent && !controller.signal.aborted)
      res
        .status(code >= 400 && code < 600 ? code : 502)
        .json({
          error:
            messages[code] ||
            "分析未完成，可能是网络超时。已保留聊天，可重试。",
        });
  } finally {
    active--;
  }
});
const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
app.use(express.static(dist));
app.get("/", (_req, res) => res.sendFile(join(dist, "index.html")));
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res
      .status(
        (err as { type?: string }).type === "entity.too.large" ? 413 : 400,
      )
      .json({ error: "输入格式或体积不受支持" });
  },
);
const port = Number(process.env.PORT || 3178);
app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Crush API: http://${process.env.HOST || "127.0.0.1"}:${port} · key ${process.env.TYPESAFE_API_KEY ? "configured" : "missing"}`,
  ),
);
