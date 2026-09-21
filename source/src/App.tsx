import { connection } from "./connection";
import { INTENTS, topIntents } from "../shared/intents";
import { REPLY_RATINGS, replyRating } from "../shared/ratings";
import { EMOTIONS, topEmotions } from "../shared/labels";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
} from "react";
import {
  Heart,
  MoreHorizontal,
  X,
  ArrowLeft,
  ArrowUpRight,
  RotateCcw,
  Plus,
  ArrowRight,
  Mic,
  Smile,
  Check,
  Sparkles,
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
import {
  normalizeClipboardText,
  readClipboardData,
  readClipboardPaste,
  readClipboardText,
} from "./clipboard";
import { conversationCharms } from "./charms";

const DRAFT_KEY = "crush-monitor-mobile-draft-v1";

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
  const [manualSenders, setManualSenders] = useState<Array<"self" | "other">>(
    [],
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  function acceptPastedText(text: string) {
    const normalized = normalizeClipboardText(text);
    setInput(normalized);
    const count = normalized.split("\n").filter((line) => line.trim()).length;
    setNotice(
      count > 1
        ? `已完整粘贴 ${count} 行，请核对后分析。`
        : "已粘贴，请核对后点击分析。",
    );
  }
  async function pasteFromPhone() {
    try {
      acceptPastedText(await readClipboardText(navigator.clipboard));
    } catch {
      setNotice("请长按输入框，选择粘贴。");
    }
  }
  function onPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const immediate = readClipboardData(event.clipboardData);
    if (!immediate) return;
    event.preventDefault();
    acceptPastedText(immediate);
    void readClipboardPaste(event.clipboardData, navigator.clipboard).then(
      (complete) => {
        if (complete) acceptPastedText(complete);
      },
    );
  }
  function submitInput() {
    if (!messages.length && !relationConfirmed) {
      openBulkEditor(input);
      setBulkRelation("");
      return;
    }
    if (single) {
      if (!input.trim()) return;
      if (!self) setSelf("我");
      if (!messages.length) setOther("对方");
      add([
        {
          id: crypto.randomUUID(),
          sender: singleSender,
          text: input.trim(),
          timestamp: null,
          kind: /^\[(图片|语音|视频|动画表情|文件)\]$/.test(input.trim())
            ? "unreadable"
            : "text",
        },
      ]);
    } else prepare(input);
  }
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [self, setSelf] = useState(""),
    [other, setOther] = useState("Crush"),
    [relation, setRelation] = useState<Relation>("crush"),
    [relationConfirmed, setRelationConfirmed] = useState(false);
  const [raw, setRaw] = useState(""),
    [parsed, setParsed] = useState<Parsed[]>([]),
    [role, setRole] = useState(""),
    [importing, setImporting] = useState(false),
    [settings, setSettings] = useState(false),
    [bulkEditing, setBulkEditing] = useState(false),
    [bulkText, setBulkText] = useState(""),
    [bulkRelation, setBulkRelation] = useState<Relation | "">(""),
    [draftKey, setDraftKey] = useState(apiKey),
    [draftEndpoint, setDraftEndpoint] = useState(endpoint),
    [draftRelation, setDraftRelation] = useState<Relation>(relation),
    [storageReady, setStorageReady] = useState(false),
    [detail, setDetail] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [overlap, setOverlap] = useState<Message[] | null>(null),
    [scope, setScope] = useState<Message[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const stay = useRef(true);
  useEffect(() => {
    try {
      const value = sessionStorage.getItem(DRAFT_KEY);
      if (value) {
        const saved = JSON.parse(value) as {
          messages?: Message[];
          self?: string;
          other?: string;
          relation?: Relation;
        };
        if (Array.isArray(saved.messages) && saved.messages.length) {
          setMessages(saved.messages);
          setSelf(saved.self || "我");
          setOther(saved.other || "Crush");
          if (saved.relation && saved.relation in RELATIONS)
            setRelation(saved.relation);
          setRelationConfirmed(true);
          setNotice("已恢复本标签页里的聊天，可继续添加或重新分析。");
        }
      }
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    } finally {
      setStorageReady(true);
    }
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    if (!messages.length) sessionStorage.removeItem(DRAFT_KEY);
    else
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ messages, self, other, relation }),
      );
  }, [storageReady, messages, self, other, relation]);
  useEffect(() => {
    void a.refreshQuota({ endpoint, key: apiKey });
  }, [endpoint, apiKey]);
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
  const imperialMode =
    messages.filter((m) => /朕|大皇帝|灵气复苏/.test(m.text)).length >= 2;
  const charms = conversationCharms(messages);
  let selfStreak = 0;
  for (
    let i = messages.length - 1;
    i >= 0 && messages[i].sender === "self";
    i--
  )
    selfStreak++;
  const last = a.history.at(-1),
    previous = a.history.at(-2);
  const delta =
    a.status === "complete" &&
    last?.comparable &&
    previous?.overview.affinity.value != null &&
    last.overview.affinity.value != null
      ? last.overview.affinity.value - previous.overview.affinity.value
      : null;
  function start(ms: Message[], selectedRelation = relation) {
    if (!withinScope(ms)) {
      setScope(ms);
      return;
    }
    setMessages(ms);
    setInput("");
    a.run(ms, selectedRelation);
  }
  function add(
    ms: Message[],
    mode: "auto" | "append" | "skip" = "auto",
    selectedRelation = relation,
  ) {
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
    start(m.messages, selectedRelation);
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
    openBulkEditor(text);
  }
  function confirmImport() {
    const names = [...new Set(parsed.map((x) => x.speaker))];
    setSelf(role);
    setOther(names.find((n) => n !== role) || "Crush");
    setImporting(false);
    add(toMessages(parsed, role));
  }
  function confirmManualImport() {
    const converted = parsed.map((message, index) => ({
      ...message,
      speaker: manualSenders[index] === "self" ? "我" : "对方",
    }));
    setSelf("我");
    setOther("对方");
    setImporting(false);
    add(toMessages(converted, "我"));
  }
  function clear() {
    a.reset();
    setMessages([]);
    setInput("");
    setSelf("");
    setOther("Crush");
    setRelationConfirmed(false);
    setNotice("");
    setSettings(false);
    setDetail(null);
    sessionStorage.removeItem(DRAFT_KEY);
  }
  function openSettings() {
    setDraftKey(apiKey);
    setDraftEndpoint(endpoint);
    setDraftRelation(relation);
    setSettings(true);
  }
  function saveSettings() {
    const nextKey = draftKey.trim();
    const nextEndpoint = draftEndpoint.trim();
    const changed =
      nextKey !== apiKey.trim() ||
      nextEndpoint !== endpoint.trim() ||
      draftRelation !== relation;
    setApiKey(nextKey);
    setEndpoint(nextEndpoint);
    setRelation(draftRelation);
    setRelationConfirmed(true);
    connection.key = nextKey;
    connection.endpoint = nextEndpoint;
    setSettings(false);
    if (changed) {
      a.reset();
      if (messages.length) a.run(messages, draftRelation);
      else void a.refreshQuota({ endpoint: nextEndpoint, key: nextKey });
    }
  }
  function updateBulkText(value: string) {
    const next = parseChat(value).messages;
    const nextNames = [...new Set(next.map((message) => message.speaker))];
    setBulkText(value);
    setParsed(next);
    setManualSenders(
      next.map((_, index) => (index % 2 === 0 ? "other" : "self")),
    );
    setRole(
      nextNames.includes(self) ? self : nextNames.includes("我") ? "我" : "",
    );
  }
  function openBulkEditor(value = input) {
    updateBulkText(value);
    setBulkRelation(relationConfirmed ? relation : "");
    setBulkEditing(true);
  }
  async function readAllIntoBulk() {
    try {
      const text = await readClipboardText(navigator.clipboard);
      updateBulkText(text);
      const count = parseChat(text).messages.length;
      setNotice(`已从系统剪贴板读取 ${count || 1} 条内容。`);
    } catch {
      setNotice("浏览器未允许直接读取，请在弹窗输入框内长按粘贴。");
    }
  }
  function confirmBulkEditor() {
    if (!bulkText.trim() || !bulkRelation) return;
    setRelation(bulkRelation);
    setRelationConfirmed(true);
    setInput(bulkText);
    if (single) {
      if (!self) setSelf("我");
      if (!messages.length) setOther("对方");
      setBulkEditing(false);
      add(
        [
          {
            id: crypto.randomUUID(),
            sender: singleSender,
            text: bulkText.trim(),
            timestamp: null,
            kind: "text",
          },
        ],
        "auto",
        bulkRelation,
      );
      return;
    }
    if (names.length === 1 && names[0] === "未分配") {
      const converted = parsed.map((message, index) => ({
        ...message,
        speaker: manualSenders[index] === "self" ? "我" : "对方",
      }));
      setSelf("我");
      setOther("对方");
      setBulkEditing(false);
      add(toMessages(converted, "我"), "auto", bulkRelation);
      return;
    }
    if (
      !role ||
      !parsed.length ||
      names.length > 2 ||
      names.includes("未分配") ||
      (!names.includes(role) && role !== "__self_absent__")
    )
      return;
    setSelf(role);
    setOther(names.find((name) => name !== role) || "Crush");
    setBulkEditing(false);
    add(toMessages(parsed, role), "auto", bulkRelation);
  }
  const names = [...new Set(parsed.map((x) => x.speaker))];
  const chosen = messages.find((m) => m.id === detail),
    result = detail ? a.lines[detail] : undefined;
  return (
    <main className="app">
      <div className="workspace">
        <section className="wechat" aria-label="微信聊天">
          <header className="chat-head">
            <button
              className="chat-back"
              aria-label="开始新聊天"
              onClick={() =>
                messages.length ? setDetail("clear") : openSettings()
              }
            >
              <ArrowLeft size={31} strokeWidth={1.8} />
            </button>
            <div className="contact-title">
              <h2>{messages.length ? other : "聊天分析"}</h2>
              <span>
                {imperialMode ? "御前模式 · " : ""}
                {RELATIONS[relation]}
              </span>
            </div>
            <button
              className="chat-more"
              aria-label="更多聊天设置"
              onClick={openSettings}
            >
              <MoreHorizontal size={29} strokeWidth={2} />
            </button>
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
                  onClick={() => openBulkEditor(exampleText(0))}
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
            {charms.length > 0 && (
              <button
                className="spark-discovery"
                onClick={() => setDetail("sparks")}
              >
                <Sparkles size={14} /> 发现 {charms.length} 个对话彩蛋
              </button>
            )}
            <div ref={bottom} />
          </div>
          <div className="chat-insights">
            <button
              className="affinity-summary"
              onClick={() => setDetail("overview")}
            >
              <span>好感度</span>
              <strong key={value} className="affinity-number">
                {value ?? "—"}
              </strong>
              {delta != null && delta !== 0 && (
                <small>
                  {delta > 0 ? "+" : ""}
                  {delta}
                </small>
              )}
              {value != null && (
                <Heart size={12} fill="currentColor" aria-hidden="true" />
              )}
            </button>
            <span className="insight-divider" />
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
              <button
                className={!single ? "selected" : ""}
                onClick={() => setSingle(false)}
              >
                整段记录
              </button>
              <button
                className={single ? "selected" : ""}
                onClick={() => setSingle(true)}
              >
                单条消息
              </button>
              {single && (
                <select
                  aria-label="这条消息是谁说的"
                  value={singleSender}
                  onChange={(e) =>
                    setSingleSender(e.target.value as "self" | "other")
                  }
                >
                  <option value="other">对方说</option>
                  <option value="self">我说</option>
                </select>
              )}
              <span className="quota-chip">
                {apiKey.trim()
                  ? "自有 Key"
                  : a.quotaLoading
                    ? "正在读取次数…"
                    : a.freeRemaining == null
                      ? "次数暂不可用"
                      : `今日剩余 ${a.freeRemaining} 次`}
              </span>
            </div>
            <div className="wechat-composer-line">
              <button
                className="compose-round"
                aria-label="语音输入提示"
                onClick={() =>
                  setNotice("请先在微信中复制文字，再回到这里粘贴。")
                }
              >
                <Mic size={25} />
              </button>
              <textarea
                ref={inputRef}
                aria-label="粘贴微信聊天记录"
                placeholder={
                  !single
                    ? "点击这里，打开整段粘贴窗口"
                    : messages.length
                      ? "粘贴一条新消息"
                      : "粘贴一条消息"
                }
                value={input}
                readOnly={!single}
                onFocus={() => {
                  if (!single) {
                    inputRef.current?.blur();
                    openBulkEditor();
                  }
                }}
                onChange={(e) => setInput(e.target.value)}
                onPaste={single ? onPaste : undefined}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    submitInput();
                }}
              />
              <button
                className="compose-round"
                aria-label="粘贴聊天"
                onClick={() => (single ? pasteFromPhone() : openBulkEditor())}
              >
                <Smile size={26} />
              </button>
              <button
                className="compose-plus"
                aria-label="粘贴聊天"
                onClick={() => (single ? pasteFromPhone() : openBulkEditor())}
              >
                <Plus size={24} />
              </button>
              <button
                className="send"
                disabled={!input.trim()}
                onClick={submitInput}
              >
                分析
              </button>
            </div>
            <div className="composer-feedback">
              <span role="status">{notice}</span>{" "}
              {selfStreak >= 3 && (
                <span className="space-reminder">
                  <Sparkles size={12} /> 已连发 {selfStreak} 条，留一点接话空间
                </span>
              )}
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
          </div>
        </section>
      </div>
      {bulkEditing && (
        <Modal title="粘贴整段聊天" close={() => setBulkEditing(false)}>
          <p className="bulk-help">
            在这里一次完成粘贴、修改、关系选择和身份确认。每条消息尽量单独一行，例如“我：内容”。
          </p>
          <label className="field required-field">
            当前关系状态（必选）
            <select
              value={bulkRelation}
              onChange={(e) => setBulkRelation(e.target.value as Relation)}
            >
              <option value="">请选择当前关系</option>
              {Object.entries(RELATIONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            聊天记录
            <textarea
              className="bulk-editor"
              autoFocus
              value={bulkText}
              placeholder={"Crush：第一条消息\n我：第二条消息"}
              onChange={(e) => updateBulkText(e.target.value)}
              onPaste={(e) => {
                const immediate = readClipboardData(e.clipboardData);
                if (!immediate) return;
                e.preventDefault();
                updateBulkText(immediate);
                void readClipboardPaste(
                  e.clipboardData,
                  navigator.clipboard,
                ).then((complete) => {
                  if (complete) updateBulkText(complete);
                });
              }}
            />
          </label>
          <button className="clipboard-retry" onClick={readAllIntoBulk}>
            <Plus size={15} /> 从系统剪贴板重新读取全部内容
          </button>
          {!single && parsed.length > 0 && (
            <div className="inline-role-confirm">
              <strong>已识别 {parsed.length} 条，确认聊天中的“我”</strong>
              {names.length === 1 && names[0] === "未分配" ? (
                <>
                  <p className="manual-help">
                    没有昵称时默认按“对方、我”交替排列，可以逐条点标签切换。
                  </p>
                  <div className="manual-actions">
                    <button
                      onClick={() =>
                        setManualSenders(
                          parsed.map((_, index) =>
                            index % 2 === 0 ? "other" : "self",
                          ),
                        )
                      }
                    >
                      首条是对方
                    </button>
                    <button
                      onClick={() =>
                        setManualSenders(
                          parsed.map((_, index) =>
                            index % 2 === 0 ? "self" : "other",
                          ),
                        )
                      }
                    >
                      首条是我
                    </button>
                  </div>
                  <div
                    className="manual-lines compact"
                    aria-label="逐条确认发送方"
                  >
                    {parsed.map((message, index) => (
                      <div
                        className="manual-line"
                        key={`${index}-${message.text}`}
                      >
                        <button
                          className={
                            manualSenders[index] === "self" ? "self" : "other"
                          }
                          onClick={() =>
                            setManualSenders((old) =>
                              old.map((sender, itemIndex) =>
                                itemIndex === index
                                  ? sender === "self"
                                    ? "other"
                                    : "self"
                                  : sender,
                              ),
                            )
                          }
                        >
                          {manualSenders[index] === "self" ? "我" : "对方"}
                        </button>
                        <span>{message.text}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="role-options">
                  {names
                    .filter((name) => name !== "未分配")
                    .map((name) => (
                      <button
                        className={role === name ? "selected" : ""}
                        key={name}
                        onClick={() => setRole(name)}
                      >
                        我是{name}
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
              )}
              {(names.length > 2 ||
                (names.includes("未分配") && names.length > 1)) && (
                <p className="error">
                  识别到多个昵称或混合格式，请先在上方文本框统一成“我：内容”“对方：内容”。
                </p>
              )}
            </div>
          )}
          <button
            className="primary"
            disabled={
              !bulkText.trim() ||
              !bulkRelation ||
              (!single &&
                (!parsed.length ||
                  names.length > 2 ||
                  (names.includes("未分配") && names.length > 1) ||
                  (names[0] !== "未分配" &&
                    (!role ||
                      (!names.includes(role) && role !== "__self_absent__")))))
            }
            onClick={confirmBulkEditor}
          >
            开始分析
          </button>
        </Modal>
      )}
      {importing && (
        <Modal title="确认聊天里的你" close={() => setImporting(false)}>
          {names.length === 1 && names[0] === "未分配" ? (
            <>
              <p className="manual-help">
                微信没有提供昵称时，请逐条确认发送方。默认按“对方、我”交替排列，可点标签修改。
              </p>
              <div className="manual-actions">
                <button
                  onClick={() =>
                    setManualSenders(
                      parsed.map((_, index) =>
                        index % 2 === 0 ? "other" : "self",
                      ),
                    )
                  }
                >
                  首条是对方
                </button>
                <button
                  onClick={() =>
                    setManualSenders(
                      parsed.map((_, index) =>
                        index % 2 === 0 ? "self" : "other",
                      ),
                    )
                  }
                >
                  首条是我
                </button>
              </div>
              <div className="manual-lines" aria-label="逐条确认发送方">
                {parsed.map((message, index) => (
                  <div className="manual-line" key={`${index}-${message.text}`}>
                    <button
                      className={
                        manualSenders[index] === "self" ? "self" : "other"
                      }
                      onClick={() =>
                        setManualSenders((old) =>
                          old.map((sender, i) =>
                            i === index
                              ? sender === "self"
                                ? "other"
                                : "self"
                              : sender,
                          ),
                        )
                      }
                    >
                      {manualSenders[index] === "self" ? "我" : "对方"}
                    </button>
                    <span>{message.text}</span>
                  </div>
                ))}
              </div>
              <button
                className="primary"
                disabled={!parsed.length}
                onClick={confirmManualImport}
              >
                按以上顺序分析
              </button>
            </>
          ) : (
            <>
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
                    const next = parseChat(e.target.value).messages;
                    setParsed(next);
                    setManualSenders(
                      next.map((_, index) =>
                        index % 2 === 0 ? "other" : "self",
                      ),
                    );
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
            </>
          )}
        </Modal>
      )}
      {settings && (
        <Modal title="聊天设置" close={() => setSettings(false)}>
          <label className="field">
            自己的 TypeSafe API Key（可选）
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="不填写可每天免费分析 10 次"
            />
          </label>
          <p>
            未填写时，同一公网 IP 每天可免费分析 10 次；填写自己的 Key
            后不限制本站次数，只消耗你自己的 TypeSafe 额度。Key
            只保留在当前页面内存中，刷新即清空。
          </p>
          {connection.endpoint ? (
            <p className="service-ready">
              <Check size={15} /> 分析服务已连接
            </p>
          ) : (
            <div className="connection-settings">
              <p>部署者设置</p>
              <label className="field">
                分析服务 HTTPS 地址
                <input
                  type="url"
                  value={draftEndpoint}
                  placeholder="https://你的服务/api/analyze"
                  onChange={(e) => setDraftEndpoint(e.target.value)}
                />
              </label>
            </div>
          )}
          <label className="field">
            你们的关系
            <select
              value={draftRelation}
              onChange={(e) => setDraftRelation(e.target.value as Relation)}
            >
              {Object.entries(RELATIONS).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={saveSettings}>
            保存设置
          </button>
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
          <p>
            聊天仅暂存在当前浏览器标签页，用于刷新恢复；清空聊天或关闭会话后即可移除。分析时会发送给模型服务。
          </p>
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
              : detail === "sparks"
                ? "对话彩蛋"
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
          {detail === "sparks" ? (
            <>
              <p>这些是完全在浏览器本地发现的小细节，不会额外消耗分析次数。</p>
              <div className="spark-list">
                {charms.map((charm) => (
                  <div className="spark-item" key={charm.key}>
                    <span aria-hidden="true">{charm.icon}</span>
                    <div>
                      <strong>{charm.label}</strong>
                      <p>{charm.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : detail === "overview" ? (
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
