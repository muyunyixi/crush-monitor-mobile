export type ClipboardReader = {
  read?: () => Promise<Array<{ types: readonly string[]; getType(type: string): Promise<Blob> }>>;
  readText?: () => Promise<string>;
};

export function joinClipboardTexts(parts: string[]) {
  return parts
    .map((part) => part.replace(/\r\n?/g, "\n").trim())
    .filter(Boolean)
    .join("\n");
}

export async function readClipboardText(clipboard: ClipboardReader) {
  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      const parts: string[] = [];
      for (const item of items) {
        const type = item.types.includes("text/plain")
          ? "text/plain"
          : item.types.find((candidate) => candidate.startsWith("text/"));
        if (type) parts.push(await (await item.getType(type)).text());
      }
      const text = joinClipboardTexts(parts);
      if (text) return text;
    } catch {
      // Mobile WebViews often expose readText even when the richer API is blocked.
    }
  }
  if (clipboard.readText) return (await clipboard.readText()).replace(/\r\n?/g, "\n");
  throw new Error("当前浏览器不支持读取剪贴板");
}
