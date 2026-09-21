export type ClipboardReader = {
  read?: () => Promise<
    Array<{ types: readonly string[]; getType(type: string): Promise<Blob> }>
  >;
  readText?: () => Promise<string>;
};

export type ClipboardData = {
  types?: readonly string[];
  items?: ArrayLike<{
    kind: string;
    type: string;
    getAsString(callback: (value: string) => void): void;
  }>;
  getData(type: string): string;
};

export function normalizeClipboardText(value: string) {
  return value
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1].toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return named[code.toLowerCase()] ?? all;
  });
}

export function htmlClipboardToText(html: string) {
  return normalizeClipboardText(
    decodeEntities(
      html
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(
          /<\/(?:div|p|li|tr|section|article|blockquote|h[1-6])\s*>/gi,
          "\n",
        )
        .replace(/<[^>]+>/g, ""),
    ),
  );
}

function richness(value: string) {
  const lines = value.split("\n").filter((line) => line.trim()).length;
  const speakerLines = value
    .split("\n")
    .filter((line) => /^\s*[^：:\n]{1,24}[：:]/.test(line)).length;
  return speakerLines * 1_000_000 + lines * 10_000 + value.length;
}

export function richestClipboardText(values: string[]) {
  return (
    values
      .map(normalizeClipboardText)
      .filter(Boolean)
      .sort((a, b) => richness(b) - richness(a))[0] ?? ""
  );
}

export function chooseClipboardText(plain = "", html = "") {
  const candidates = [
    normalizeClipboardText(plain),
    htmlClipboardToText(html),
  ].filter(Boolean);
  return richestClipboardText(candidates);
}

function itemText(item: NonNullable<ClipboardData["items"]>[number]) {
  return new Promise<string>((resolve) => {
    try {
      item.getAsString((value) => resolve(value));
    } catch {
      resolve("");
    }
  });
}

export async function readClipboardItems(data: ClipboardData) {
  const items = Array.from(data.items ?? []).filter(
    (item) => item.kind === "string" && item.type.startsWith("text/"),
  );
  const values = await Promise.all(items.map(itemText));
  const plain = values
    .filter((_, index) => items[index].type === "text/plain")
    .map(normalizeClipboardText);
  const html = values
    .filter((_, index) => items[index].type === "text/html")
    .map(htmlClipboardToText);
  const other = values
    .filter(
      (_, index) => !["text/plain", "text/html"].includes(items[index].type),
    )
    .map(normalizeClipboardText);
  return richestClipboardText([
    ...values.map((value, index) =>
      items[index].type === "text/html" ? htmlClipboardToText(value) : value,
    ),
    joinClipboardTexts(plain),
    joinClipboardTexts(html),
    joinClipboardTexts(other),
  ]);
}

export async function readClipboardPaste(
  data: ClipboardData,
  clipboard?: ClipboardReader,
) {
  const immediate = readClipboardData(data);
  const candidates = [immediate];
  const itemPromise = readClipboardItems(data).catch(() => "");
  const systemPromise = clipboard
    ? readClipboardText(clipboard).catch(() => "")
    : Promise.resolve("");
  candidates.push(await itemPromise, await systemPromise);
  return richestClipboardText(candidates);
}

export function readClipboardData(data: ClipboardData) {
  return chooseClipboardText(
    data.getData("text/plain") || data.getData("text"),
    data.getData("text/html"),
  );
}

export function joinClipboardTexts(parts: string[]) {
  return parts.map(normalizeClipboardText).filter(Boolean).join("\n");
}

export async function readClipboardText(clipboard: ClipboardReader) {
  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      const parts: string[] = [];
      for (const item of items) {
        let plain = "";
        let html = "";
        for (const type of item.types) {
          if (type === "text/plain" || type === "text/html") {
            const value = await (await item.getType(type)).text();
            if (type === "text/plain") plain = value;
            else html = value;
          }
        }
        const best = chooseClipboardText(plain, html);
        if (best) parts.push(best);
      }
      const text = joinClipboardTexts(parts);
      if (text) return text;
    } catch {
      // Mobile WebViews often expose readText even when the richer API is blocked.
    }
  }
  if (clipboard.readText)
    return normalizeClipboardText(await clipboard.readText());
  throw new Error("当前浏览器不支持读取剪贴板");
}
