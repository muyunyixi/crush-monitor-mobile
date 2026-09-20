import { connection } from "./connection";
import { INTENTS, topIntents } from "../shared/intents";
import { REPLY_RATINGS, replyRating } from "../shared/ratings";
import { EMOTIONS, topEmotions } from "../shared/labels";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Heart,
  MoreHorizontal,
  X,
  ArrowUpRight,
  RotateCcw,
  MessageCircle,
  Settings2,
  Plus,
  ArrowRight,
  Send,
  Check,
} from "lucide-react";
import {
  parseChat,
  toMessages,
  mergeMessages,
  withinScope,
  recentScope,
} from "../shared/parser";
import {
  ACTIONS,
  RELATIONS,
  statusLabel,
  meanQuality,
  type Message,
  type Relation,
  type Parsed,
} from "../shared/types";
import { exampleText } from "../shared/fixtures";
import { useAnalysis } from "./useAnalysis";

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),select,textarea,input",
          ) || [],
        );
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="关闭" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const a = useAnalysis();
  const [apiKey, setApiKey] = useState(connection.key);
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [single, setSingle] = useState(false);
  const [singleSender, setSingleSender] = useState<"self" | "other">("other");
  async function pasteFromPhone() {
    try { setInput(await navigator.clipboard.readText()); setNotice("已粘贴，请核对后点击分析聊天。"); }
    catch { setNotice("请长按输入框，选择粘贴。"); }
  }
  function submitInput() {
    if (single) {
      if (!input.trim()) return;
      if (!self) setSelf("我");
      if (!messages.length) setOther("对方");
      add([{ id: crypto.randomUUID(), sender: singleSender, text: input.trim(), timestamp: null, kind: /^\[(图片|语音|视频|动画表情|文件)\]$/.test(input.trim()) ? "unreadable" : "text" }]);
    } else prepare(input);
  }
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [self, setSelf] = useState(""),
    [other, setOther] = useState("Crush"),
    [relation, setRelation] = useState<Relation>("crush");
  const [raw, setRaw] = useState(""),
    [parsed, setParsed] = useState<Parsed[]>([]),
    [role, setRole] = useState(""),
    [importing, setImporting] = useState(false),
    [settings, setSettings] = useState(false),
    [detail, setDetail] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [overlap, setOverlap] = useState<Message[] | null>(null),
    [scope, setScope] = useState<Message[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const stay = useRef(true);
  useEffect(() => {
    if (stay.current) {
      const scroller = bottom.current?.parentElement;
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length]);
  const busy = a.status === "loading",
    ov = a.overview,
    value = ov?.affinity.value,
    quality = meanQuality(messages, a.lines);
  const last = a.history.at(-1),
    previous = a.history.at(-2);
  const delta =
    a.status === "complete" &&
    last?.comparable &&
    previous?.overview.affinity.value != null &&
    last.overview.affinity.value != null
      ? last.overview.affinity.value - previous.overview.affinity.value
      : null;
  function start(ms: Message[]) {
    if (!withinScope(ms)) {
      setScope(ms);
      return;
    }
    setMessages(ms);
    setInput("");
    a.run(ms, relation);
  }
  function add(ms: Message[], mode: "auto" | "append" | "skip" = "auto") {
    const m = mergeMessages(messages, ms, mode);
    if (m.ambiguous) {
      setOverlap(ms);
      return;
    }
    if (!m.added) {
      setNotice("没有新增消息，这段已经分析过了。");
      setInput("");
      return;
    }
    setNotice("");
    start(m.messages);
  }
  function prepare(text: string) {
    if (!text.trim()) return;
    if (text.length > 100000) {
      setNotice("请分段粘贴，每次不超过 120 条。");
      return;
    }
    const p = parseChat(text);
    const names = [...new Set(p.messages.map((x) => x.speaker))];
    if (
      messages.length &&
      self &&
      !p.warnings.length &&
      names.every((n) => n === self || n === other)
    ) {
      add(toMessages(p.messages, self));
      return;
    }
    setRaw(text);
    setParsed(p.messages);
    setRole(names.includes(self) ? self : names.includes("我") ? "我" : "");
    setImporting(true);
  }
  function confirmImport() {
    const names = [...new Set(parsed.map((x) => x.speaker))];
    setSelf(role);
    setOther(names.find((n) => n !== role) || "Crush");
    setImporting(false);
    add(toMessages(parsed, role));
  }
  function clear() {
    a.reset();
    setMessages([]);
    setInput("");
    setSelf("");
    setOther("Crush");
    setNotice("");
    setSettings(false);
    setDetail(null);
  }
  const names = [...new Set(parsed.map((x) => x.speaker))];
  const chosen = messages.find((m) => m.id === detail),
    result = detail ? a.lines[detail] : undefined;
  return (
    <main className="app">
      <div className="workspace">
        <section className="wechat" aria-label="微信聊天">
          <nav className="chat-rail" aria-label="聊天工具">
            <div className="rail-avatar">
              {self && self !== "__self_absent__" ? self.slice(0, 1) : "我"}
            </div>
            <button
              className="rail-active"
              aria-label="滚动到最新聊天"
              onClick={() => {
                const el = bottom.current?.parentElement;
                el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              }}
            >
              <MessageCircle size={23} />
            </button>
            <button
              className="rail-settings"
              aria-label="聊天设置"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={22} />
            </button>
          </nav>
          <header className="chat-head">
            <div className="contact-title">
              <h2>{messages.length ? other : "微信聊天"}</h2>
              <span>{RELATIONS[relation]}</span>
            </div>
            <button
              className="header-affinity"
              onClick={() => setDetail("overview")}
              aria-label="查看好感度详情"
            >
              <span>好感度</span>
              <strong key={value} className="affinity-number">
                {value ?? "—"}
              </strong>
              {value != null && (
                <span className="affinity-hearts" aria-hidden="true">
                  <Heart className="affinity-heart heart-one" size={12} />
                  <Heart className="affinity-heart heart-two" size={9} />
                  <Heart className="affinity-heart heart-three" size={7} />
                </span>
              )}
              {delta != null && delta !== 0 && (
                <small>
                  {delta > 0 ? "+" : ""}
                  {delta}
                </small>
              )}
            </button>
            <div className="header-tools">
              <button
                className="icon"
                aria-label="新聊天"
                title="新聊天"
                onClick={() => setDetail("clear")}
              >
                <Plus size={20} />
              </button>
              <button
                className="icon"
                aria-label="更多聊天设置"
                onClick={() => setSettings(true)}
              >
                <MoreHorizontal size={24} />
              </button>
            </div>
          </header>
          <div
            className="chat-scroll"
            onScroll={(e) => {
              const el = e.currentTarget;
              stay.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            }}
          >
            {!messages.length ? (
              <div className="empty">
                <h2>粘贴微信聊天记录</h2>
                <p>长按微信文字复制，返回这里粘贴</p>
                <button
                  className="text-button"
                  onClick={() => prepare(exampleText(0))}
                >
                  用一段示例试试 <ArrowUpRight size={16} />
                </button>
              </div>
            ) : (
              messages.map((m, i) => {
                const r = a.lines[m.id];

                return (
                  <div
                    key={m.id}
                    id={`message-${m.id}`}
                    className={`message ${m.sender}`}
                  >
                    {(i === 0 || m.timestamp !== messages[i - 1].timestamp) &&
                      m.timestamp && (
                        <div className="timestamp">
                          {m.timestamp.replace(/^\d{4}年/, "")}
                        </div>
                      )}
                    <div className="message-row">
                      <div
                        className={`avatar ${m.sender === "self" ? "mine" : ""}`}
                      >
                        {(m.sender === "self" ? self : other).slice(0, 1)}
                      </div>
                      <div className="message-content">
                        <div className="bubble">{m.text}</div>
                        {m.kind === "text" && (
                          <div className={`message-tags ${m.sender}`}>
                            {m.sender === "other" ? (
                              <>
                                <div className="analysis-row emotion-row">
                                  <span className="analysis-row-label">
                                    情绪
                                  </span>
                                  {r?.emotions ? (
                                    topEmotions(r.emotions).map((emotion) => (
                                      <button
                                        key={emotion.key}
                                        className={`emotion-tag emotion-${emotion.key}`}
                                        onClick={() => setDetail(m.id)}
                                        aria-label={`${emotion.label} ${emotion.percent}，查看情绪分析：${m.text}`}
                                      >
                                        <span>{emotion.label}</span>
                                        <b>{emotion.percent}</b>
                                      </button>
                                    ))
                                  ) : (
                                    <button
                                      className="pending-tag"
                                      disabled={busy}
                                      onClick={() => a.run(messages, relation)}
                                    >
                                      {busy ? "分析中" : "分析情绪"}
                                    </button>
                                  )}
                                </div>
                                <div className="analysis-row intent-row">
                                  <span className="analysis-row-label">
                                    意图
                                  </span>
                                  {r?.intents ? (
                                    topIntents(r.intents).map((intent) => (
                                      <button
                                        key={intent.key}
                                        className="intent-tag"
                                        onClick={() => setDetail(m.id)}
                                        aria-label={`${intent.label} ${intent.percent}，查看意图分析：${m.text}`}
                                      >
                                        <span>{intent.label}</span>
                                        <b>{intent.percent}</b>
                                      </button>
                                    ))
                                  ) : (
                                    <button
                                      className="pending-tag"
                                      disabled={busy}
                                      onClick={() => a.run(messages, relation)}
                                    >
                                      {busy ? "分析中" : "分析意图"}
                                    </button>
                                  )}
                                </div>
                              </>
                            ) : r ? (
                              <button
                                className="reply-tag"
                                onClick={() => setDetail(m.id)}
                                aria-label={`查看回复评价：${m.text}`}
                              >
                                <span>回复评级：</span>
                                <b>
                                  {replyRating(r.score.value)?.label ??
                                    "待判断"}
                                </b>
                              </button>
                            ) : (
                              <button
                                className="pending-tag"
                                disabled={busy}
                                onClick={() => a.run(messages, relation)}
                              >
                                {busy ? "分析中" : "评价回复"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottom} />
          </div>
          <div className="chat-insights">
            <button
              className="reply-summary"
              onClick={() => setDetail("performance")}
            >
              <span>我的发挥</span>
              <strong>{replyRating(quality)?.label ?? "—"}</strong>
              {quality != null && <span>{quality}分</span>}
            </button>
            <span className="insight-divider" />
            <button
              className="action-summary"
              onClick={() => setDetail("action")}
            >
              <span>下一步</span>
              <strong>{ov ? ACTIONS[ov.action]?.label : "等你导入聊天"}</strong>
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="composer">
            <div className="mobile-import">
              <button className={!single ? "selected" : ""} onClick={() => setSingle(false)}>整段记录</button>
              <button className={single ? "selected" : ""} onClick={() => setSingle(true)}>单条消息</button>
              {single && <select aria-label="这条消息是谁说的" value={singleSender} onChange={e => setSingleSender(e.target.value as "self" | "other")}><option value="other">对方说</option><option value="self">我说</option></select>}
              <button onClick={pasteFromPhone}>粘贴</button>
            </div>
            <textarea
              aria-label="粘贴微信聊天记录"
              placeholder={
                messages.length
                  ? "粘贴新的聊天，自动合并重复记录"
                  : "在这里粘贴微信聊天记录…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                  submitInput();
              }}
            />
            <div className="composer-bottom">
              <div className="composer-feedback">
                <span role="status">{notice}</span>{" "}
                <div className="analysis-status" aria-live="polite">
                  {busy ? (
                    <>
                      <span className="working" />
                      正在分析 {a.progress.done}/{a.progress.total}
                      <button onClick={a.cancel}>停止</button>
                    </>
                  ) : a.status === "error" ? (
                    <>
                      <span>分析未完成</span>
                      <button onClick={() => a.run(messages, relation)}>
                        <RotateCcw size={14} />
                        重试
                      </button>
                    </>
                  ) : a.status === "complete" ? (
                    <span className="completed">
                      <Check size={14} />
                      分析完成
                      <button onClick={() => setDetail("overview")}>
                        娱乐参考
                      </button>
                    </span>
                  ) : messages.length ? (
                    <>
                      <span>分析已暂停</span>
                      <button onClick={() => a.run(messages, relation)}>
                        继续分析
                      </button>
                    </>
                  ) : null}
                </div>
                {a.error && <span className="error">{a.error}</span>}
              </div>
              <button
                className="send"
                disabled={!input.trim()}
                onClick={submitInput}
              >
                <Send size={15} />
                分析聊天
              </button>
            </div>
          </div>
        </section>
      </div>
      {importing && (
        <Modal title="确认聊天里的你" close={() => setImporting(false)}>
          <div className="role-options">
            {names
              .filter((n) => n !== "未分配")
              .map((n) => (
                <button
                  className={role === n ? "selected" : ""}
                  key={n}
                  onClick={() => setRole(n)}
                >
                  {n}
                </button>
              ))}
            {names.length === 1 && (
              <button
                className={role === "__self_absent__" ? "selected" : ""}
                onClick={() => setRole("__self_absent__")}
              >
                这些都是对方的话
              </button>
            )}
          </div>
          <label className="field">
            识别到 {parsed.length} 条聊天
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setParsed(parseChat(e.target.value).messages);
              }}
            />
          </label>
          {(names.length > 2 || names.includes("未分配")) && (
            <p className="error">
              单条复制的纯文字请关闭此窗口，选择「单条消息」。整段导入请保留两个人的聊天，可改成「我：内容」「对方：内容」。
            </p>
          )}
          <button
            className="primary"
            disabled={
              !role ||
              !parsed.length ||
              names.length > 2 ||
              names.includes("未分配") ||
              (!names.includes(role) && role !== "__self_absent__")
            }
            onClick={confirmImport}
          >
            开始分析
          </button>
        </Modal>
      )}
      {settings && (
        <Modal title="聊天设置" close={() => setSettings(false)}>
          <label className="field">TypeSafe API Key
            <input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={e => {setApiKey(e.target.value); connection.key = e.target.value; a.reset();}} placeholder="输入自己的 API Key" />
          </label>
          <p>密钥和聊天只在当前页面内存中保留，刷新即清空。点击分析会把聊天发送至 TypeSafe，并使用你的 API 额度。</p>
          <details><summary>连接设置（直连失败时使用）</summary>
            <label className="field">自建分析服务 HTTPS 地址
              <input type="url" value={endpoint} placeholder="https://你的服务/api/analyze" onChange={e => {setEndpoint(e.target.value); connection.endpoint = e.target.value.trim(); a.reset();}} />
            </label><p>仅填写自己信任的服务；该服务会接收聊天和密钥。留空直接连接 TypeSafe。</p>
          </details>
          <label className="field">
            你们的关系
            <select
              value={relation}
              onChange={(e) => {
                const r = e.target.value as Relation;
                setRelation(r);
                if (messages.length) a.run(messages, r);
              }}
            >
              {Object.entries(RELATIONS).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={!messages.length}
            onClick={() => {
              const ms = messages.map((m) => ({
                ...m,
                sender:
                  m.sender === "self" ? ("other" as const) : ("self" as const),
              }));
              setSelf(other);
              setOther(self === "__self_absent__" ? "我" : self);
              setMessages(ms);
              a.reset();
              a.run(ms, relation);
              setSettings(false);
            }}
          >
            交换双方身份
          </button>
          <button className="secondary danger" onClick={clear}>
            清空聊天，重新开始
          </button>
          <p>聊天只保留在当前页面，分析时发送给模型服务。</p>
        </Modal>
      )}
      {detail === "clear" && (
        <Modal title="开始新的聊天？" close={() => setDetail(null)}>
          <p>当前聊天和分析会清空。</p>
          <button className="primary" onClick={clear}>
            开始新聊天
          </button>
          <button className="secondary" onClick={() => setDetail(null)}>
            保留当前聊天
          </button>
        </Modal>
      )}
      {detail && detail !== "clear" && (
        <Modal
          title={
            detail === "overview"
              ? "好感度"
              : detail === "action"
                ? "下一步"
                : detail === "performance"
                  ? "我的发挥"
                  : chosen?.sender === "other"
                    ? "情绪与意图"
                    : "回复评价"
          }
          close={() => setDetail(null)}
        >
          {detail === "overview" ? (
            <>
              <p>
                0—100 是模型对这段聊天的好感信号评分，不是「对方喜欢你的概率」。
              </p>
              <p>
                有评分就展示数值。上下文少或表达模糊时，也保留数值供娱乐参考。
              </p>
              {ov && (
                <p>
                  本轮判断：{statusLabel(ov.affinity)}。模型确定度{" "}
                  {Math.round(ov.affinity.confidence * 100)}%。
                </p>
              )}
            </>
          ) : detail === "action" ? (
            <>
              <h3>{ov ? ACTIONS[ov.action]?.label : "等待聊天"}</h3>
              <p>{ov ? ACTIONS[ov.action]?.detail : "导入后生成建议。"}</p>
              {ov?.actionEvidenceId && (
                <blockquote>
                  {messages.find((m) => m.id === ov.actionEvidenceId)?.text}
                </blockquote>
              )}
            </>
          ) : detail === "performance" ? (
            <>
              <div className="detail-score">
                {quality ?? "—"}
                <span>/100</span>
              </div>
              <p>
                已完成分析的我方回复平均分。Jev
                根据发出时的前文评价表达质量，再按固定分数区间显示评级。
              </p>
              <div className="reply-guide">
                {REPLY_RATINGS.map((v) => (
                  <p key={v.label}>
                    <strong>
                      {v.label} · {v.range} 分
                    </strong>
                    ：{v.description}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <>
              <blockquote>{chosen?.text}</blockquote>
              {chosen?.sender === "other" ? (
                <>
                  <h3>情绪</h3>
                  <div className="emotion-distribution">
                    {Object.entries(result?.emotions || {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([key, p]) => (
                        <div key={key}>
                          <span>
                            {EMOTIONS[key as keyof typeof EMOTIONS]?.label ||
                              key}
                          </span>
                          <div className="probability-track">
                            <i style={{ width: `${p * 100}%` }} />
                          </div>
                          <b>
                            {p > 0 && p < 0.005
                              ? "<1%"
                              : `${Math.round(p * 100)}%`}
                          </b>
                        </div>
                      ))}
                  </div>
                  <h3 className="intent-detail-heading">意图</h3>
                  <div className="intent-distribution">
                    {Object.entries(result?.intents || {})
                      .filter(([key, p]) => key in INTENTS && p > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([key, p]) => (
                        <div key={key} className="intent-detail-item">
                          <div>
                            <strong>
                              {INTENTS[key as keyof typeof INTENTS].label}
                            </strong>
                            <b>
                              {p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`}
                            </b>
                          </div>
                          <p>{INTENTS[key as keyof typeof INTENTS].criteria}</p>
                        </div>
                      ))}
                    {!result?.intents && <p>意图尚未分析。</p>}
                  </div>
                  <p>
                    两行分别展示主要情绪与主要沟通意图的候选解读，不代表测量真实内心。每行最多显示前三项，保留原始概率，不重新凑成
                    100%。
                  </p>
                </>
              ) : (
                <>
                  <h3 className="reply-verdict">
                    回复评级：
                    {replyRating(result?.score.value)?.label ?? "待判断"}
                  </h3>
                  <p>
                    {replyRating(result?.score.value)?.description ??
                      "当前语境不足以判断表达质量"}
                  </p>
                  <p>
                    回复评分 {result?.score.value ?? "—"} / 100 ·{" "}
                    {result && statusLabel(result.score)}
                  </p>
                </>
              )}
              <p>结合当前已导入的上下文判断，不代表对方真实想法。</p>
            </>
          )}
        </Modal>
      )}
      {overlap && (
        <Modal title="这段可能重复了" close={() => setOverlap(null)}>
          <p>相同内容也可能是新消息，请选择如何合并。</p>
          <button
            className="primary"
            onClick={() => {
              add(overlap, "skip");
              setOverlap(null);
            }}
          >
            跳过重合部分
          </button>
          <button
            className="secondary"
            onClick={() => {
              add(overlap, "append");
              setOverlap(null);
            }}
          >
            作为新消息追加
          </button>
        </Modal>
      )}
      {scope && (
        <Modal title="聊天有点长" close={() => setScope(null)}>
          <p>一次分析最多 120 条、24,000 字，保留最近一段继续。</p>
          <button
            className="primary"
            disabled={!recentScope(scope).length}
            onClick={() => {
              start(recentScope(scope));
              setScope(null);
            }}
          >
            分析最近的聊天
          </button>
        </Modal>
      )}
    </main>
  );
}
