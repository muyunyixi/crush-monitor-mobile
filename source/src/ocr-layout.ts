export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrLine = {
  text: string;
  confidence: number;
  bbox: OcrBox;
  group?: number;
};

function cleanText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\ufeff\ufffd]/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g, "$1")
    .replace(/[|¦]{2,}/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[^\p{L}\p{N}\u3400-\u9fff]+/u, "")
    .replace(/[^\p{L}\p{N}\u3400-\u9fff！？!?。，,.~～…：:；;）)】\]」』]+$/u, "")
    .trim();
}

export function cleanChatTitle(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map(cleanText)
    .map((line) =>
      line
        .replace(/^\d{1,2}:\d{2}\s*/, "")
        .replace(/[<>…·•|]+/g, " ")
        .trim(),
    )
    .filter(
      (line) =>
        line.length > 0 &&
        line.length <= 30 &&
        !/^(微信|返回|更多|聊天信息|\d+%?)$/i.test(line),
    );
  return lines.sort((a, b) => b.length - a.length)[0] || "对方";
}

function isUsefulText(value: string) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^(\d{1,2}:\d{2}|上午|下午|昨天|星期|周[一二三四五六日天])/.test(text))
    return false;
  if (/撤回了一条消息|以下为新消息|以上是打招呼的内容/.test(text))
    return false;
  const meaningful = text.replace(/[^\p{L}\p{N}\u3400-\u9fff]/gu, "");
  const compact = text.replace(/\s/g, "");
  if (!/[\u3400-\u9fff]/.test(meaningful) && meaningful.length < 2)
    return false;
  return meaningful.length / Math.max(1, compact.length) >= 0.55;
}

export function chatLinesFromLayout(
  lines: OcrLine[],
  imageWidth: number,
  nickname: string,
) {
  const name = cleanChatTitle(nickname);
  const messages = lines
    .filter((line) => line.confidence >= 42 && isUsefulText(line.text))
    .map((line) => {
      const leftGap = Math.max(0, line.bbox.x0);
      const rightGap = Math.max(0, imageWidth - line.bbox.x1);
      const width = line.bbox.x1 - line.bbox.x0;
      if (
        width < imageWidth * 0.48 &&
        Math.abs(leftGap - rightGap) < imageWidth * 0.08
      )
        return null;
      return {
        y: line.bbox.y0,
        bottom: line.bbox.y1,
        height: Math.max(1, line.bbox.y1 - line.bbox.y0),
        group: line.group,
        speaker: leftGap < rightGap ? name : "我",
        text: cleanText(line.text),
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line))
    .sort((a, b) => a.y - b.y);

  const merged: typeof messages = [];
  for (const line of messages) {
    const previous = merged.at(-1);
    const gap = previous ? line.y - previous.bottom : Infinity;
    const sameParagraph =
      previous?.group != null && line.group === previous.group;
    const wrappedLine =
      previous?.speaker === line.speaker &&
      gap >= -Math.max(previous.height, line.height) * 0.2 &&
      gap <= Math.max(previous.height, line.height) * 0.55;
    if (previous && previous.speaker === line.speaker && (sameParagraph || wrappedLine)) {
      previous.text = `${previous.text}${/[\u3400-\u9fff]$/.test(previous.text) && /^[\u3400-\u9fff]/.test(line.text) ? "" : " "}${line.text}`;
      previous.bottom = Math.max(previous.bottom, line.bottom);
      previous.height = previous.bottom - previous.y;
    } else if (
      !previous ||
      previous.speaker !== line.speaker ||
      previous.text !== line.text
    ) {
      merged.push({ ...line });
    }
  }
  return merged.map((line) => `${line.speaker}：${line.text}`);
}
