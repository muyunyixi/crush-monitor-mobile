export type OcrBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrLine = { text: string; confidence: number; bbox: OcrBox };

function cleanText(value: string) {
  return value
    .replace(/\s*\n\s*/g, " ")
    .replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s{2,}/g, " ")
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
  return /[\u3400-\u9fff]/.test(meaningful) || meaningful.length >= 2;
}

export function chatLinesFromLayout(
  lines: OcrLine[],
  imageWidth: number,
  nickname: string,
) {
  const name = cleanChatTitle(nickname);
  const messages = lines
    .filter((line) => line.confidence >= 35 && isUsefulText(line.text))
    .map((line) => {
      const leftGap = Math.max(0, line.bbox.x0);
      const rightGap = Math.max(0, imageWidth - line.bbox.x1);
      if (Math.abs(leftGap - rightGap) < imageWidth * 0.08) return null;
      return {
        y: line.bbox.y0,
        speaker: leftGap < rightGap ? name : "我",
        text: cleanText(line.text),
      };
    })
    .filter((line): line is NonNullable<typeof line> => Boolean(line))
    .sort((a, b) => a.y - b.y);

  const unique = messages.filter(
    (line, index) =>
      index === 0 ||
      line.speaker !== messages[index - 1].speaker ||
      line.text !== messages[index - 1].text,
  );
  return unique.map((line) => `${line.speaker}：${line.text}`);
}
