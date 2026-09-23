import { connection } from "./connection";
import { INTENTS, topIntents } from "../shared/intents";
import { REPLY_RATINGS, replyRating } from "../shared/ratings";
import { EMOTIONS, topEmotions } from "../shared/labels";
import {
  useEffect,
  useRef,
  useState,
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
  Camera,
  Download,
} from "lucide-react";
import html2canvas from "html2canvas";
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
  STAGES,
  statusLabel,
  meanQuality,
  type Message,
  type Relation,
  type Parsed,
} from "../shared/types";
import { exampleText } from "../shared/fixtures";
import { useAnalysis } from "./useAnalysis";
import { normalizeClipboardText } from "./clipboard";
import { recognizeScreenshots } from "./ocr";
import { conversationCharms } from "./charms";

const SCREENSHOT_VERSION = "v1.4.0-scroll-mode-ready";
const DRAFT_KEY = "crush-monitor-mobile-draft-v1";
const TONE_CHIPS = ["🙂", "😂", "🥹", "🙈", "🤔", "👍", "收到", "好呀", "哈哈", "晚点回"];

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

/**
 * 聊天记录粘贴编辑器 (RichPasteEditor)
 * 采用原生非受控机制，不拦截 event.preventDefault()，确保浏览器与输入法的原生粘贴流水线完整工作，
 * 解决移动端/微信多选复制多条时因 React 同步重渲染中断 Android 剪贴板片段写入的问题。
 */
function RichPasteEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isPastingRef = useRef(false);
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (textareaRef.current && !isPastingRef.current) {
      if (textareaRef.current.value !== value) {
        textareaRef.current.value = value;
      }
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
    };
  }, []);

  const handlePaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    // 绝对不调用 event.preventDefault()，允许浏览器与输入法原生的粘贴流水线完整工作
    isPastingRef.current = true;
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);

    // 延迟等待浏览器与输入法将剪贴板的所有片段完整交付到 DOM 节点
    pasteTimerRef.current = setTimeout(() => {
      isPastingRef.current = false;
      const el = textareaRef.current;
      if (!el) return;
      onChange(el.value);
    }, 60);
  };

  const handleInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if (isPastingRef.current) {
      // 粘贴过程中连续触发 input（如多片段依次写入），重置防抖计时，避免 React 中断后续片段写入
      if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
      pasteTimerRef.current = setTimeout(() => {
        isPastingRef.current = false;
        onChange(el.value);
      }, 60);
      return;
    }
    onChange(el.value);
  };

  return (
    <textarea
      ref={textareaRef}
      className="bulk-editor rich-paste-editor"
      aria-label="聊天记录"
      id="bulk-chat-editor"
      placeholder={"Crush：第一条消息\n我：第二条消息"}
      defaultValue={value}
      onPaste={handlePaste}
      onInput={handleInput}
    />
  );
}

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
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty(
        "--dialog-vh",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      document.documentElement.style.setProperty(
        "--dialog-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
      document.documentElement.dataset.dialogKeyboard =
        viewport && viewport.height < window.innerHeight * 0.72
          ? "open"
          : "closed";
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),select,textarea,input,[contenteditable="true"]',
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
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      delete document.documentElement.dataset.dialogKeyboard;
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
        className={`modal ${title === "粘贴整段聊天" ? "import-modal" : ""} ${title === "情绪与意图" ? "analysis-modal" : ""}`}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="关闭" onClick={close}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
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
  const [importStatus, setImportStatus] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [charmPage, setCharmPage] = useState(0);
  const [dictating, setDictating] = useState(false);
  const pasteRevision = useRef(0);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  function submitInput() {
    if (!messages.length && !relationConfirmed) {
      openBulkEditor(input);
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
  const [parsed, setParsed] = useState<Parsed[]>([]),
    [role, setRole] = useState(""),
    [settings, setSettings] = useState(false),
    [bulkEditing, setBulkEditing] = useState(false),
    [bulkText, setBulkText] = useState(""),
    [bulkRelation, setBulkRelation] = useState<Relation | "">("crush"),
    [draftKey, setDraftKey] = useState(apiKey),
    [draftEndpoint, setDraftEndpoint] = useState(endpoint),
    [draftRelation, setDraftRelation] = useState<Relation>(relation),
    [storageReady, setStorageReady] = useState(false),
    [detail, setDetail] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [screenshotRange, setScreenshotRange] = useState<"10" | "20" | "50" | "all">("20");
  const [includeHeader, setIncludeHeader] = useState(true);
  const [includeMessages, setIncludeMessages] = useState(true);
  const [includeAnalysis, setIncludeAnalysis] = useState(true);
  const [screenshotGenerating, setScreenshotGenerating] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [isScrollMode, setIsScrollMode] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const screenshotContainerRef = useRef<HTMLDivElement>(null);
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
    if (stay.current || a.error) {
      const scroller = bottom.current?.parentElement;
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, a.error, a.status]);
  useEffect(
    () => () => {
      speechRef.current?.stop();
    },
    [],
  );

  function toggleDictation() {
    if (dictating) {
      speechRef.current?.stop();
      return;
    }
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("当前浏览器不支持语音转文字，可以使用系统键盘的语音输入。");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join("")
        .trim();
      if (transcript)
        setInput((old) => `${old}${old && !old.endsWith(" ") ? " " : ""}${transcript}`);
    };
    recognition.onerror = () => {
      setNotice("没有听清，点麦克风可以再试一次。");
    };
    recognition.onend = () => {
      speechRef.current = null;
      setDictating(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    speechRef.current = recognition;
    setSingle(true);
    setDictating(true);
    setNotice("正在听，识别结果会放进输入框。再点一次可停止。");
    try {
      recognition.start();
    } catch {
      setDictating(false);
      setNotice("语音输入启动失败，请检查浏览器麦克风权限。");
    }
  }

  function addTone(value: string) {
    setSingle(true);
    setInput((old) => `${old}${old ? " " : ""}${value}`);
    setDetail(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function copyConversation() {
    if (!messages.length) return;
    const text = messages
      .map((message) =>
        `${message.sender === "self" ? self || "我" : other || "对方"}：${message.text}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`已复制整理后的 ${messages.length} 条记录。`);
    } catch {
      setNotice("复制失败，请在整段记录窗口中手动选择文字。");
    }
    setDetail(null);
  }

  const busy = a.status === "loading",
    ov = a.overview,
    value = ov?.affinity.value,
    quality = meanQuality(messages, a.lines);
  const imperialMode =
    messages.filter((m) => /朕|大皇帝|灵气复苏/.test(m.text)).length >= 2;
  const charms = conversationCharms(messages);
  const selfCount = messages.filter((message) => message.sender === "self").length;
  const otherCount = messages.length - selfCount;
  const turns = messages.reduce(
    (count, message, index) =>
      index > 0 && message.sender !== messages[index - 1].sender
        ? count + 1
        : count,
    0,
  );
  const rhythm =
    !messages.length
      ? "等待聊天"
      : Math.abs(selfCount - otherCount) <= Math.max(1, messages.length * 0.2)
        ? "你来我往"
        : selfCount > otherCount
          ? "我方更主动"
          : "对方更主动";

  const isWeChat =
    typeof navigator !== "undefined" &&
    /micromessenger/i.test(navigator.userAgent);

  const screenshotMessages = (() => {
    if (screenshotRange === "10") return messages.slice(-10);
    if (screenshotRange === "20") return messages.slice(-20);
    if (screenshotRange === "50") return messages.slice(-50);
    return messages;
  })();

  async function handleGenerateScreenshot() {
    if (!screenshotContainerRef.current) return;
    setScreenshotGenerating(true);
    setScreenshotError(null);

    // 核心拦截器：无论安卓机型自带何种字体引擎或 offsetTop + 2 采样偏差，
    // 在 Canvas 底层 fillText 绘制中文与文本时，强制向上修正 Y 坐标偏移（2.5px），
    // 从而使所有气泡文字、头像文字、胶囊标签文字绝对居中对齐，杜绝下沉！
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    const hookedCanvases = new WeakSet<object>();

    try {
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
        const type = args[0];
        const ctx: any = origGetContext.apply(this, args as any);
        if (type === "2d" && ctx && !hookedCanvases.has(this)) {
          hookedCanvases.add(this);
          const origFillText = ctx.fillText;
          ctx.fillText = function (this: any, textStr: string, x: number, y: number, maxWidth?: number) {
            const offsetY = 2.5;
            if (typeof maxWidth === "number") {
              origFillText.call(this, textStr, x, y - offsetY, maxWidth);
            } else {
              origFillText.call(this, textStr, x, y - offsetY);
            }
          };
        }
        return ctx;
      } as any;

      if (document.fonts) {
        await document.fonts.ready;
      }
      await new Promise((r) => setTimeout(r, 80));

      const targetEl = screenshotContainerRef.current;
      const renderWidth = targetEl.offsetWidth || 414;
      const renderHeight = targetEl.scrollHeight || targetEl.offsetHeight;

      const canvas = await html2canvas(targetEl, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ededed",
        logging: false,
        width: renderWidth,
        height: renderHeight,
        windowWidth: 414,
        windowHeight: Math.max(renderHeight, 1000),
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        onclone: (clonedDoc) => {
          // 1. 隔离 HTML/Body 避免小屏全局缩放或基线污染
          if (clonedDoc.documentElement) {
            clonedDoc.documentElement.style.fontSize = "14px";
            clonedDoc.documentElement.style.margin = "0";
            clonedDoc.documentElement.style.padding = "0";
          }
          if (clonedDoc.body) {
            clonedDoc.body.style.margin = "0";
            clonedDoc.body.style.padding = "0";
            clonedDoc.body.style.backgroundColor = "#ededed";
          }

          // 2. 同时劫持克隆文档 iframe 内的 Canvas context，保证双重覆盖
          try {
            const win: any = clonedDoc.defaultView;
            if (win && win.HTMLCanvasElement && win.HTMLCanvasElement.prototype) {
              const cloneOrigGetContext = win.HTMLCanvasElement.prototype.getContext;
              win.HTMLCanvasElement.prototype.getContext = function (this: any, ...args: any[]) {
                const type = args[0];
                const ctx: any = cloneOrigGetContext.apply(this, args);
                if (type === "2d" && ctx && !hookedCanvases.has(this)) {
                  hookedCanvases.add(this);
                  const origFill = ctx.fillText;
                  ctx.fillText = function (this: any, textStr: string, x: number, y: number, maxWidth?: number) {
                    const offsetY = 2.5;
                    if (typeof maxWidth === "number") {
                      origFill.call(this, textStr, x, y - offsetY, maxWidth);
                    } else {
                      origFill.call(this, textStr, x, y - offsetY);
                    }
                  };
                }
                return ctx;
              };
            }
          } catch (_) {}

          const el = clonedDoc.querySelector(".screenshot-render-target") as HTMLElement | null;
          if (el) {
            // 确保在克隆文档中处于确定物理流布局，清除负坐标
            el.style.position = "static";
            el.style.left = "0";
            el.style.top = "0";
            el.style.margin = "0";
            el.style.transform = "none";
            el.style.width = "414px";
            el.style.minWidth = "414px";
            el.style.maxWidth = "414px";
          }
        },
      });

      const dataUrl = canvas.toDataURL("image/png");
      setScreenshotDataUrl(dataUrl);
    } catch (err: unknown) {
      console.error("Screenshot error:", err);
      setScreenshotError("长截图生成失败，请重试或减少截取条数");
    } finally {
      // 截图完成后立即恢复原生 getContext，零污染全局其他业务与主项目
      HTMLCanvasElement.prototype.getContext = origGetContext;
      setScreenshotGenerating(false);
    }
  }

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
    pasteRevision.current++;
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
    setBulkRelation(relationConfirmed ? relation : "crush");
    setImportStatus("");
    setBulkEditing(true);
  }

  async function importImages(files: FileList | null) {
    if (!files?.length || ocrBusy) return;
    setOcrBusy(true);
    const revision = pasteRevision.current;
    try {
      const text = await recognizeScreenshots(
        Array.from(files),
        setImportStatus,
      );
      if (revision === pasteRevision.current) {
        updateBulkText([bulkText, text].filter(Boolean).join("\n"));
        setImportStatus(
          "识别完成。已过滤状态栏、输入栏和居中提示，并按左右气泡标记双方；请核对文字。",
        );
      } else
        setImportStatus("识别期间文本已修改，未覆盖当前内容。请重新选择截图。");
    } catch (e) {
      setImportStatus(`识别失败：${(e as Error).message}`);
    } finally {
      setOcrBusy(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  }
  async function importText(file?: File) {
    if (!file) return;
    if (file.size > 400000) {
      setImportStatus("文本文件请小于 400 KB。");
      return;
    }
    updateBulkText(normalizeClipboardText(await file.text()));
    setImportStatus("已完整读取文本文件，请核对后分析。");
    if (textInput.current) textInput.current.value = "";
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
  if (isScrollMode) {
    return (
      <div className="scroll-capture-screen">
        <div className="scroll-capture-bar">
          <button
            type="button"
            className="scroll-capture-back"
            onClick={() => setIsScrollMode(false)}
          >
            ← 退出长截屏模式
          </button>
          <div className="scroll-capture-tip">
            💡 手机按电源+音量键截屏，点击屏幕弹出的<strong>【长截屏】/【滚动截屏】</strong>即可截取整页！
          </div>
        </div>
        <div className="scroll-capture-content">
          {/* 顶部真实微信风格导航栏 */}
          <header className="ssr-chat-head">
            <div className="ssr-head-back">
              <ArrowLeft size={28} strokeWidth={1.8} />
            </div>
            <div className="ssr-head-title">
              <h2>{other || "微信好友"}</h2>
              <span>
                {imperialMode ? "御前模式 · " : ""}
                {RELATIONS[relation]}
              </span>
            </div>
            <div className="ssr-head-more">
              <MoreHorizontal size={26} strokeWidth={2} />
            </div>
          </header>

          {/* 顶部关系与互动档案卡片 */}
          {includeHeader && (
            <div className="ssr-header-card">
              <div className="ssr-top-row">
                <span className="ssr-logo">💚 Crush 聊天记录监视器</span>
                <span className="ssr-badge">
                  {imperialMode ? "御前模式 · " : ""}
                  {RELATIONS[relation]}
                </span>
              </div>
              <div className="ssr-contact-row">
                <h3>与【{other}】的对话档案</h3>
                <p>
                  生成时间：{new Date().toLocaleDateString("zh-CN")}{" "}
                  {new Date().toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="ssr-stats-grid">
                <div className="ssr-stat-item">
                  <small>心动指数</small>
                  <strong>{value ?? "—"}{value != null ? "%" : ""}</strong>
                </div>
                <div className="ssr-stat-item">
                  <small>我的发挥</small>
                  <strong>{replyRating(quality)?.label ?? "—"}</strong>
                </div>
                <div className="ssr-stat-item">
                  <small>互动节奏</small>
                  <strong>{turns}次接话</strong>
                </div>
                <div className="ssr-stat-item">
                  <small>发言比例</small>
                  <strong>
                    {selfCount}:{otherCount}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* 核心消息流：原生 DOM 呈现，100% 完美字体排版与居中 */}
          {includeMessages && (
            <div className="ssr-messages-wrap">
              <div className="ssr-messages-title">
                <span>💬 聊天记录片段（共 {screenshotMessages.length} 条）</span>
              </div>
              <div className="ssr-messages-list">
                {screenshotMessages.map((m, i) => {
                  const isOther = m.sender === "other";
                  const lineResult = a.lines[m.id];
                  const showTimestamp =
                    (i === 0 || m.timestamp !== screenshotMessages[i - 1]?.timestamp) &&
                    Boolean(m.timestamp);
                  return (
                    <div
                      key={m.id}
                      className={`message ${m.sender}`}
                    >
                      {showTimestamp && (
                        <div className="timestamp">
                          {m.timestamp ? m.timestamp.replace(/^\d{4}年/, "") : ""}
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
                              {isOther ? (
                                <>
                                  {lineResult?.emotions && (
                                    <div className="analysis-row emotion-row">
                                      <span className="analysis-row-label">
                                        情绪
                                      </span>
                                      {topEmotions(lineResult.emotions).map(
                                        (emotion) => (
                                          <span
                                            key={emotion.key}
                                            className={`emotion-tag emotion-${emotion.key}`}
                                          >
                                            <span>{emotion.label}</span>
                                            <b>{emotion.percent}</b>
                                          </span>
                                        ),
                                      )}
                                    </div>
                                  )}
                                  {lineResult?.intents && (
                                    <div className="analysis-row intent-row">
                                      <span className="analysis-row-label">
                                        意图
                                      </span>
                                      {topIntents(lineResult.intents).map(
                                        (intent) => (
                                          <span
                                            key={intent.key}
                                            className="intent-tag"
                                          >
                                            <span>{intent.label}</span>
                                            <b>{intent.percent}</b>
                                          </span>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </>
                              ) : lineResult ? (
                                <div className="analysis-row">
                                  <span className="reply-tag">
                                    <span>回复评级：</span>
                                    <b>
                                      {replyRating(lineResult.score.value)?.label ??
                                        "待判断"}
                                    </b>
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 底部深度分析报告卡片 */}
          {includeAnalysis && ov && (
            <div className="ssr-analysis-card">
              <div className="ssr-analysis-title">
                <Sparkles size={16} /> 深度关系与意图诊断报告
              </div>
              <div className="ssr-analysis-body">
                <div className="ssr-analysis-row">
                  <span className="ssr-analysis-label">当前关系阶段：</span>
                  <strong className="ssr-analysis-val">
                    {STAGES[ov.stage] ?? "观察中"}
                  </strong>
                </div>
                <div className="ssr-analysis-row">
                  <span className="ssr-analysis-label">建议下一步策略：</span>
                  <strong className="ssr-analysis-val highlight">
                    {ACTIONS[ov.action]?.label ?? "顺着聊"}
                  </strong>
                </div>
                <div className="ssr-analysis-desc">
                  {ACTIONS[ov.action]?.detail}
                </div>
              </div>
            </div>
          )}

          <div className="ssr-footer">
            <span>Crush 聊天记录监视器 · 情感分析与心动诊断 · 仅供参考</span>
          </div>
        </div>
      </div>
    );
  }

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
                  用一段示例试试
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
                          {m.timestamp ? m.timestamp.replace(/^\d{4}年/, "") : ""}
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
                onClick={() => {
                  setCharmPage(0);
                  setDetail("sparks");
                }}
              >
                <Sparkles size={14} /> 发现 {charms.length} 个对话彩蛋
              </button>
            )}
            {a.error && (
              <div className="chat-system" role="alert">
                {a.error}
                <button onClick={openSettings}>聊天设置</button>
              </div>
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
                className={`compose-round ${dictating ? "active" : ""}`}
                aria-label={dictating ? "停止语音转文字" : "语音转文字"}
                onClick={toggleDictation}
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
                onClick={() => {
                  if (!single) {
                    inputRef.current?.blur();
                    openBulkEditor();
                  }
                }}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    submitInput();
                }}
              />
              <button
                className="compose-round"
                aria-label="打开语气工具箱"
                onClick={() => setDetail("tones")}
              >
                <Smile size={26} />
              </button>
              <button
                className="compose-plus"
                aria-label="打开聊天工具箱"
                onClick={() => setDetail("tools")}
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
            </div>
          </div>
        </section>
      </div>
      {bulkEditing && (
        <Modal title="粘贴整段聊天" close={() => setBulkEditing(false)}>
          <p className="bulk-help">
            截图识字会裁掉状态栏和输入栏，并按左右气泡区分双方。
          </p>
          <label className="field required-field import-relation">
            当前关系状态（必选）
            <select
              value={bulkRelation}
              onChange={(e) => setBulkRelation(e.target.value as Relation)}
            >
              {Object.entries(RELATIONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            聊天记录
            <RichPasteEditor
              value={bulkText}
              onChange={updateBulkText}
            />
          </label>
          <div className="import-tools">
            <button
              disabled={ocrBusy}
              onClick={() => imageInput.current?.click()}
            >
              截图识字
            </button>
            <button
              disabled={ocrBusy}
              onClick={() => textInput.current?.click()}
            >
              导入 TXT
            </button>
            <input
              hidden
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(e) => void importImages(e.target.files)}
            />
            <input
              hidden
              ref={textInput}
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => void importText(e.target.files?.[0])}
            />
          </div>
          <p className="import-tip">
            请选择输入法剪切板中的内容直接粘贴
          </p>
          {importStatus && (
            <p className="import-status" role="status">
              {importStatus}
            </p>
          )}
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
              ocrBusy ||
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
              : detail === "tones"
                ? "语气工具箱"
                : detail === "tools"
                  ? "聊天工具箱"
              : detail === "screenshot"
                ? (screenshotDataUrl ? "长截图预览" : "生成长截图")
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
          close={() => {
            setDetail(null);
            setScreenshotDataUrl(null);
            setScreenshotError(null);
          }}
        >
          {detail === "tones" ? (
            <>
              <p className="tool-intro">点一下加入输入框，仍可继续修改。</p>
              <div className="tone-grid">
                {TONE_CHIPS.map((tone) => (
                  <button key={tone} onClick={() => addTone(tone)}>
                    {tone}
                  </button>
                ))}
              </div>
              <div className="micro-tip">
                <Sparkles size={15} /> 同一句话加不同语气会产生不同解读，发送前可以先读一遍。
              </div>
            </>
          ) : detail === "tools" ? (
            <>
              <div className="local-stats" aria-label="本地聊天速览">
                <div><strong>{messages.length}</strong><span>消息</span></div>
                <div><strong>{turns}</strong><span>接话</span></div>
                <div><strong>{selfCount}:{otherCount}</strong><span>双方条数</span></div>
                <div><strong>{rhythm}</strong><span>当前节奏</span></div>
              </div>
              <div className="tool-actions">
                <button
                  onClick={() => {
                    setDetail(null);
                    openBulkEditor();
                  }}
                >
                  <strong>导入整段记录</strong>
                  <span>富文本粘贴、截图识字、TXT</span>
                </button>
                <button
                  onClick={() => {
                    setDetail(null);
                    openBulkEditor(exampleText(0));
                  }}
                >
                  <strong>载入示例</strong>
                  <span>不消耗次数，分析时才计次</span>
                </button>
                <button disabled={!messages.length} onClick={() => void copyConversation()}>
                  <strong>复制整理记录</strong>
                  <span>自动补上双方昵称</span>
                </button>
                <button
                  disabled={!messages.length || busy}
                  onClick={() => {
                    setDetail(null);
                    a.run(messages, relation);
                  }}
                >
                  <strong>重新分析</strong>
                  <span>用当前设置刷新结果</span>
                </button>
                <button
                  className="tool-action-featured"
                  disabled={!messages.length}
                  onClick={() => {
                    setScreenshotDataUrl(null);
                    setScreenshotError(null);
                    setDetail("screenshot");
                  }}
                >
                  <strong>📸 生成长截图</strong>
                  <span>自选范围导出聊天与分析档案</span>
                </button>
              </div>
              {charms.length > 0 && (
                <button
                  className="tool-spark-link"
                  onClick={() => {
                    setCharmPage(0);
                    setDetail("sparks");
                  }}
                >
                  <Sparkles size={15} /> 查看 {charms.length} 个本地对话彩蛋
                </button>
              )}
            </>
          ) : detail === "screenshot" ? (
            screenshotDataUrl ? (
              <div className="screenshot-preview-pane">
                <div className={`screenshot-tip ${isWeChat ? "screenshot-tip-wechat" : ""}`}>
                  {isWeChat ? (
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: "3px" }}>
                        ⚠️ 微信内保存长图提示
                      </div>
                      <div>
                        微信内置浏览器限制了直接下载。建议点击右上角<strong>【···】</strong>选择<strong>【在浏览器打开】</strong>进行顺畅保存；或者在下方长按图片选择<strong>【保存图片】</strong>。<span style={{ display: "inline-block", marginLeft: "6px", fontSize: "10px", color: "#8a5800", background: "#fff0cb", padding: "1px 5px", borderRadius: "3px", fontWeight: "bold" }}>{SCREENSHOT_VERSION}</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Sparkles size={15} /> 提示：在系统浏览器中可点击下方<strong>【保存长图到本地相册】</strong>一键下载，也可在手机上<strong>长按下方长图</strong>选择【保存图片】。<span style={{ display: "inline-block", marginLeft: "6px", fontSize: "10px", color: "#2b7a4c", background: "#e8f5e9", padding: "1px 5px", borderRadius: "3px", fontWeight: "bold" }}>{SCREENSHOT_VERSION}</span>
                    </div>
                  )}
                </div>
                <div className="screenshot-img-container">
                  <img
                    src={screenshotDataUrl}
                    alt="聊天与分析长截图"
                    className="screenshot-preview-img"
                  />
                </div>
                <div className="screenshot-preview-actions">
                  <a
                    href={screenshotDataUrl}
                    download={`crush-chat-${other || "record"}-${new Date().toISOString().slice(0, 10)}.png`}
                    className="primary screenshot-download-btn"
                    onClick={() => {
                      if (isWeChat) {
                        setNotice("微信内限制直接下载文件，请长按图片保存或在右上角【···】选择在浏览器打开。");
                      }
                    }}
                  >
                    <Download size={16} /> 保存长图到本地相册
                  </a>
                  <button
                    className="secondary"
                    onClick={() => setScreenshotDataUrl(null)}
                  >
                    🔄 重新调整范围与设置
                  </button>
                </div>
              </div>
            ) : (
              <div className="screenshot-config-pane">
                <div className="screenshot-config-section">
                  <label className="screenshot-label">
                    截取消息范围
                    <span className="screenshot-sub-label">
                      （总计 {messages.length} 条，当前选中 {screenshotMessages.length} 条）
                    </span>
                  </label>
                  <div className="screenshot-chips">
                    {[
                      { id: "10", label: "最近 10 条" },
                      { id: "20", label: "最近 20 条 (推荐)" },
                      { id: "50", label: "最近 50 条" },
                      { id: "all", label: `全部 (${messages.length}条)` },
                    ].map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        className={`screenshot-chip ${screenshotRange === chip.id ? "active" : ""}`}
                        onClick={() => setScreenshotRange(chip.id as any)}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="screenshot-config-section">
                  <label className="screenshot-label">包含内容板块</label>
                  <div className="screenshot-checkbox-group">
                    <label className="screenshot-checkbox-item">
                      <input
                        type="checkbox"
                        checked={includeHeader}
                        onChange={(e) => setIncludeHeader(e.target.checked)}
                      />
                      <div>
                        <strong>顶部状态档案</strong>
                        <span>双方昵称、关系状态、心动指数与发挥评分</span>
                      </div>
                    </label>
                    <label className="screenshot-checkbox-item">
                      <input
                        type="checkbox"
                        checked={includeMessages}
                        onChange={(e) => setIncludeMessages(e.target.checked)}
                      />
                      <div>
                        <strong>聊天气泡与逐句详细分析</strong>
                        <span>完整保留微信气泡、逐句情绪与意图标签、回复评级（已选 {screenshotMessages.length} 条）</span>
                      </div>
                    </label>
                    <label className="screenshot-checkbox-item">
                      <input
                        type="checkbox"
                        checked={includeAnalysis}
                        onChange={(e) => setIncludeAnalysis(e.target.checked)}
                      />
                      <div>
                        <strong>底部分析报告</strong>
                        <span>当前关系阶段诊断、潜台词解读与下一步策略</span>
                      </div>
                    </label>
                  </div>
                </div>

                {screenshotError && (
                  <div className="screenshot-error-box" role="alert">
                    {screenshotError}
                  </div>
                )}

                <button
                  type="button"
                  className="primary screenshot-generate-btn"
                  style={{ background: "#07c160", border: "none", color: "#fff", fontWeight: "bold" }}
                  disabled={
                    (!includeHeader && !includeMessages && !includeAnalysis) ||
                    (includeMessages && screenshotMessages.length === 0)
                  }
                  onClick={() => {
                    setDetail(null);
                    setIsScrollMode(true);
                  }}
                >
                  📱 开启全屏纯净模式（支持手机系统长截屏/滚动截屏）
                </button>
                <div style={{ textAlign: "center", margin: "6px 0", fontSize: "11px", color: "#888" }}>
                  或者使用浏览器 Canvas 合成下载：
                </div>
                <button
                  type="button"
                  className="secondary screenshot-generate-btn"
                  disabled={
                    screenshotGenerating ||
                    (!includeHeader && !includeMessages && !includeAnalysis) ||
                    (includeMessages && screenshotMessages.length === 0)
                  }
                  onClick={handleGenerateScreenshot}
                >
                  {screenshotGenerating ? (
                    <>⏳ 正在高清合成长图中...</>
                  ) : (
                    <>
                      <Camera size={16} /> 生成普通长图文件并保存
                    </>
                  )}
                </button>
              </div>
            )
          ) : detail === "sparks" ? (
            <>
              <p>这些是完全在浏览器本地发现的小细节，不会额外消耗分析次数。</p>
              <div className="charm-pages">
                <button
                  disabled={charmPage === 0}
                  onClick={() => setCharmPage((p) => p - 1)}
                >
                  上一页
                </button>
                <span>
                  {charmPage + 1} / {Math.max(1, Math.ceil(charms.length / 2))}
                </span>
                <button
                  disabled={(charmPage + 1) * 2 >= charms.length}
                  onClick={() => setCharmPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
              <div className="spark-list">
                {charms.slice(charmPage * 2, charmPage * 2 + 2).map((charm) => (
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
              <div className="analysis-context">
                <span>本条消息</span>
                <blockquote>{chosen?.text}</blockquote>
              </div>
              {chosen?.sender === "other" ? (
                <>
                  <section className="analysis-panel emotion-panel">
                    <header>
                      <span>01</span>
                      <div>
                        <h3>情绪信号</h3>
                        <p>更像哪几种表达状态</p>
                      </div>
                    </header>
                    <div className="emotion-distribution">
                      {Object.entries(result?.emotions || {})
                        .filter(([, p]) => p > 0)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([key, p], index) => (
                          <div key={key}>
                            <span className="emotion-rank">{index + 1}</span>
                            <span className="emotion-name">
                              {EMOTIONS[key as keyof typeof EMOTIONS]?.label || key}
                            </span>
                            <div className="probability-track">
                              <i style={{ width: `${p * 100}%` }} />
                            </div>
                            <b>{p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`}</b>
                          </div>
                        ))}
                    </div>
                  </section>
                  <section className="analysis-panel intent-panel">
                    <header>
                      <span>02</span>
                      <div>
                        <h3>沟通意图</h3>
                        <p>这句话可能在推动什么</p>
                      </div>
                    </header>
                    <div className="intent-distribution">
                      {Object.entries(result?.intents || {})
                        .filter(([key, p]) => key in INTENTS && p > 0)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([key, p]) => (
                          <div key={key} className="intent-detail-item">
                            <div>
                              <strong>{INTENTS[key as keyof typeof INTENTS].label}</strong>
                              <b>{p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`}</b>
                            </div>
                            <p>{INTENTS[key as keyof typeof INTENTS].criteria}</p>
                          </div>
                        ))}
                      {!result?.intents && <p>意图尚未分析。</p>}
                    </div>
                  </section>
                  <div className="analysis-note">
                    概率用于排列候选解释，不等于测量对方真实想法，也不会强行凑成 100%。
                  </div>
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
              {chosen && (
                <button
                  className="copy-message"
                  onClick={() => {
                    void navigator.clipboard.writeText(chosen.text);
                    setNotice("已复制这条消息。");
                    setDetail(null);
                  }}
                >
                  复制这条消息
                </button>
              )}
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
      {/* 隐藏的离屏渲染节点，供 html2canvas 生成高清长截图 */}
      <div
        ref={screenshotContainerRef}
        className="screenshot-render-target"
        aria-hidden="true"
      >
        {/* 顶部真实微信风格导航栏 */}
        <header className="ssr-chat-head">
          <div className="ssr-head-back">
            <ArrowLeft size={28} strokeWidth={1.8} />
          </div>
          <div className="ssr-head-title">
            <h2>{other || "微信好友"}</h2>
            <span>
              {imperialMode ? "御前模式 · " : ""}
              {RELATIONS[relation]}
            </span>
          </div>
          <div className="ssr-head-more">
            <MoreHorizontal size={26} strokeWidth={2} />
          </div>
        </header>

        {/* 顶部关系与互动档案卡片（可勾选） */}
        {includeHeader && (
          <div className="ssr-header-card">
            <div className="ssr-top-row">
              <span className="ssr-logo">💚 Crush 聊天记录监视器</span>
              <span className="ssr-badge">
                {imperialMode ? "御前模式 · " : ""}
                {RELATIONS[relation]}
              </span>
            </div>
            <div className="ssr-contact-row">
              <h3>与【{other}】的对话档案</h3>
              <p>
                生成时间：{new Date().toLocaleDateString("zh-CN")}{" "}
                {new Date().toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="ssr-stats-grid">
              <div className="ssr-stat-item">
                <small>心动指数</small>
                <strong>{value ?? "—"}{value != null ? "%" : ""}</strong>
              </div>
              <div className="ssr-stat-item">
                <small>我的发挥</small>
                <strong>{replyRating(quality)?.label ?? "—"}</strong>
              </div>
              <div className="ssr-stat-item">
                <small>互动节奏</small>
                <strong>{turns}次接话</strong>
              </div>
              <div className="ssr-stat-item">
                <small>发言比例</small>
                <strong>
                  {selfCount}:{otherCount}
                </strong>
              </div>
            </div>
          </div>
        )}

        {/* 核心消息流：1:1 原生映射页面真实结构与样式 */}
        {includeMessages && (
          <div className="ssr-messages-wrap">
            <div className="ssr-messages-title">
              <span>💬 聊天记录片段（共 {screenshotMessages.length} 条）</span>
            </div>
            <div className="ssr-messages-list">
              {screenshotMessages.map((m, i) => {
                const isOther = m.sender === "other";
                const lineResult = a.lines[m.id];
                const showTimestamp =
                  (i === 0 || m.timestamp !== screenshotMessages[i - 1]?.timestamp) &&
                  Boolean(m.timestamp);

                return (
                  <div
                    key={m.id}
                    className={`message ${m.sender}`}
                  >
                    {showTimestamp && (
                      <div className="timestamp">
                        {m.timestamp ? m.timestamp.replace(/^\d{4}年/, "") : ""}
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
                            {isOther ? (
                              <>
                                {lineResult?.emotions && (
                                  <div className="analysis-row emotion-row">
                                    <span className="analysis-row-label">
                                      情绪
                                    </span>
                                    {topEmotions(lineResult.emotions).map(
                                      (emotion) => (
                                        <span
                                          key={emotion.key}
                                          className={`emotion-tag emotion-${emotion.key}`}
                                        >
                                          <span>{emotion.label}</span>
                                          <b>{emotion.percent}</b>
                                        </span>
                                      ),
                                    )}
                                  </div>
                                )}
                                {lineResult?.intents && (
                                  <div className="analysis-row intent-row">
                                    <span className="analysis-row-label">
                                      意图
                                    </span>
                                    {topIntents(lineResult.intents).map(
                                      (intent) => (
                                        <span
                                          key={intent.key}
                                          className="intent-tag"
                                        >
                                          <span>{intent.label}</span>
                                          <b>{intent.percent}</b>
                                        </span>
                                      ),
                                    )}
                                  </div>
                                )}
                              </>
                            ) : lineResult ? (
                              <div className="analysis-row">
                                <span className="reply-tag">
                                  <span>回复评级：</span>
                                  <b>
                                    {replyRating(lineResult.score.value)?.label ??
                                      "待判断"}
                                  </b>
                                </span>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 底部深度分析报告卡片（可勾选） */}
        {includeAnalysis && ov && (
          <div className="ssr-analysis-card">
            <div className="ssr-analysis-title">
              <Sparkles size={16} /> 深度关系与意图诊断报告
            </div>
            <div className="ssr-analysis-body">
              <div className="ssr-analysis-row">
                <span className="ssr-analysis-label">当前关系阶段：</span>
                <strong className="ssr-analysis-val">
                  {STAGES[ov.stage] ?? "观察中"}
                </strong>
              </div>
              <div className="ssr-analysis-row">
                <span className="ssr-analysis-label">建议下一步策略：</span>
                <strong className="ssr-analysis-val highlight">
                  {ACTIONS[ov.action]?.label ?? "顺着聊"}
                </strong>
              </div>
              <div className="ssr-analysis-desc">
                {ACTIONS[ov.action]?.detail}
              </div>
            </div>
          </div>
        )}

        <div className="ssr-footer">
          <span>Crush 聊天记录监视器 · 情感分析与心动诊断 · 仅供参考</span>
        </div>
      </div>
    </main>
  );
}
