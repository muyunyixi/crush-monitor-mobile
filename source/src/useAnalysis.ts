import { analyze, requestSchema } from "../server/analysis";
import { connection } from "./connection";
import { useRef, useState } from "react";
import {
  contextKey,
  meanQuality,
  type Message,
  type Relation,
  type Snapshot,
  type Overview,
  type LineResult,
  type AnalysisResponse,
  type AnalysisRequest,
} from "../shared/types";
export function useAnalysis() {
  const [overview, setOverview] = useState<Overview | null>(null),
    [overviewFresh, setOverviewFresh] = useState(false),
    [lines, setLines] = useState<Record<string, LineResult>>({}),
    [status, setStatus] = useState<"idle" | "loading" | "complete" | "error">(
      "idle",
    ),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Snapshot[]>([]),
    [progress, setProgress] = useState({ done: 0, total: 0 }),
    [latency, setLatency] = useState(0),
    [currentIds, setCurrentIds] = useState<Set<string>>(new Set());
  const rev = useRef(0),
    controller = useRef<AbortController | null>(null),
    cache = useRef(new Map<string, AnalysisResponse>()),
    historyRef = useRef<Snapshot[]>([]);
  function cancel() {
    rev.current++;
    controller.current?.abort();
    setStatus("idle");
  }
  function reset() {
    cancel();
    cache.current.clear();
    historyRef.current = [];
    setHistory([]);
    setOverview(null);
    setOverviewFresh(false);
    setLines({});
    setError("");
    setLatency(0);
    setCurrentIds(new Set());
  }
  function showFixture(s: Snapshot) {
    cancel();
    setOverview(s.overview);
    setOverviewFresh(true);
    setLines(s.lines);
    setStatus("complete");
    setError("");
    setLatency(0);
    setCurrentIds(new Set(s.messages.map((m) => m.id)));
  }
  async function run(messages: Message[], relation: Relation) {
    const revision = ++rev.current;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const start = performance.now();
    setStatus("loading");
    setOverviewFresh(false);
    setError("");
    setCurrentIds(new Set());
    let nextOverview: Overview | null = null;
    const nextLines: Record<string, LineResult> = {};
    let failures = 0;
    let done = 0;
    const task = (
      task: AnalysisRequest["task"],
      targetIds: string[],
      ms = messages,
    ): AnalysisRequest => ({
      revision,
      relation,
      messages: ms,
      task,
      targetIds,
    });
    const others = messages.filter(
      (m) => m.sender === "other" && m.kind === "text",
    );
    const batches: AnalysisRequest[] = [];
    for (let i = others.length; i > 0; i -= 20)
      batches.push(
        task(
          "other_messages",
          others.slice(Math.max(0, i - 20), i).map((m) => m.id),
        ),
      );
    const self = messages.flatMap((m, i) =>
      m.sender === "self" && m.kind === "text"
        ? [task("self_message", [m.id], messages.slice(0, i + 1))]
        : [],
    );
    const jobs = [
      task("overview", []),
      ...batches.slice(0, 1),
      ...self.reverse(),
      ...batches.slice(1),
    ];
    setProgress({ done: 0, total: jobs.length });
    async function execute(job: AnalysisRequest) {
      const key =
        contextKey(job.messages, relation) + job.task + job.targetIds.join(",");
      let result = cache.current.get(key);
      if (!result) {
        if (!connection.key.trim()) throw new Error("请先在右上角设置中填写 TypeSafe API Key。");
        const validated = requestSchema.parse(job);
        if (connection.endpoint) {
          const endpoint = new URL(connection.endpoint);
          if (endpoint.protocol !== "https:") throw new Error("自建分析服务必须使用 HTTPS 地址");
          const response = await fetch(endpoint, {
            method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${connection.key}` },
            body: JSON.stringify(validated), signal: ctrl.signal,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "分析服务请求失败");
          result = data as AnalysisResponse;
        } else {
          result = await analyze(validated, ctrl.signal, connection.key);
        }
        if (result.revision !== revision)
          throw new Error("分析批次不匹配，请重试");
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(contextKey(job.messages, relation)),
        );
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (result.contextHash !== hash)
          throw new Error("分析上下文不匹配，请重试");
        if (rev.current !== revision) return;
        cache.current.set(key, result);
      }
      if (rev.current !== revision) return;
      if (result.overview) {
        nextOverview = result.overview;
        setOverview(result.overview);
        setOverviewFresh(true);
        setLatency(Math.round(performance.now() - start));
      }
      for (const line of result.lines || []) {
        nextLines[line.id] = line;
      }
      setLines((old) => ({ ...old, ...nextLines }));
      setCurrentIds(new Set(Object.keys(nextLines)));
    }
    async function worker() {
      while (jobs.length && rev.current === revision) {
        const job = jobs.shift()!;
        try {
          await execute(job);
        } catch (e) {
          if (ctrl.signal.aborted || rev.current !== revision) return;
          failures++;
          setError((e as Error).message);
        } finally {
          if (rev.current === revision)
            setProgress((p) => ({ ...p, done: ++done }));
        }
      }
    }
    await Promise.all([worker(), worker()]);
    if (rev.current !== revision) return;
    setLines(nextLines);
    setCurrentIds(new Set(Object.keys(nextLines)));
    setStatus(failures ? "error" : "complete");
    if (nextOverview && !failures) {
      const previous = historyRef.current.at(-1);
      const s: Snapshot = {
        revision,
        messages: structuredClone(messages),
        relation,
        lines: nextLines,
        overview: nextOverview,
        at: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - start),
        source: "live",
        comparable:
          !!previous &&
          previous.relation === relation &&
          previous.messages.every(
            (m, i) =>
              messages[i]?.id === m.id &&
              messages[i]?.text === m.text &&
              messages[i]?.sender === m.sender,
          ),
      };
      const same =
        previous &&
        contextKey(previous.messages, previous.relation) ===
          contextKey(messages, relation);
      historyRef.current = same
        ? [...historyRef.current.slice(0, -1), s]
        : [...historyRef.current, s];
      setHistory(historyRef.current);
    }
  }
  return {
    overview,
    overviewFresh,
    lines,
    status,
    error,
    clearError: () => setError(""),
    history,
    progress,
    latency,
    currentIds,
    run,
    reset,
    cancel,
    showFixture,
    meanQuality,
  };
}
