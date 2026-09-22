import { createWorker, PSM } from "tesseract.js";
import { chatLinesFromLayout, cleanChatTitle, type OcrLine } from "./ocr-layout";

function cropCanvas(
  bitmap: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
  scale = 1,
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas
    .getContext("2d")!
    .drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function collectParagraphs(
  blocks: Array<{
    paragraphs: Array<{ text: string; confidence: number; bbox: OcrLine["bbox"] }>;
  }> | null,
): OcrLine[] {
  return (blocks ?? []).flatMap((block) =>
    block.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      confidence: paragraph.confidence,
      bbox: paragraph.bbox,
    })),
  );
}

// The engine and language assets are served from this site, never a third-party CDN.
export async function recognizeScreenshots(
  files: File[],
  progress: (text: string) => void,
) {
  if (files.length > 6) throw new Error("每次最多选择 6 张截图。");
  if (files.some((f) => f.size > 12 * 1024 * 1024))
    throw new Error("单张截图请小于 12 MB。");
  if (location.protocol === "file:")
    throw new Error("截图识字需要通过网站地址打开。");
  const base = new URL("./ocr/", location.href).href;
  progress("首次使用正在加载识字资源，请稍候…");
  const worker = await createWorker("chi_sim+eng", 1, {
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "recognizing text")
        progress(`本机识字 ${Math.round(m.progress * 100)}%`);
    },
  });
  const parts: string[] = [];
  let knownTitle = "";
  try {
    for (let i = 0; i < files.length; i++) {
      progress(`分析第 ${i + 1} / ${files.length} 张截图的聊天区域…`);
      const bitmap = await createImageBitmap(files[i]);
      try {
        if (bitmap.width * bitmap.height > 24000000)
          throw new Error("截图过长，请拆成几张再导入。");

        // A normal WeChat screenshot uses roughly the first 10% for the status/title
        // bars and the last 8.5% for the composer. They are intentionally excluded.
        const titleCanvas = cropCanvas(
          bitmap,
          bitmap.width * 0.2,
          bitmap.height * 0.04,
          bitmap.width * 0.6,
          bitmap.height * 0.06,
          2,
        );
        const chatTop = Math.round(bitmap.height * 0.1);
        const chatBottom = Math.round(bitmap.height * 0.915);
        const chatCanvas = cropCanvas(
          bitmap,
          0,
          chatTop,
          bitmap.width,
          chatBottom - chatTop,
        );

        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const titleResult = await worker.recognize(titleCanvas);
        const title = cleanChatTitle(titleResult.data.text);
        if (title !== "对方") knownTitle = title;

        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const result = await worker.recognize(
          chatCanvas,
          {},
          { text: true, blocks: true },
        );
        const lines = collectParagraphs(result.data.blocks);
        parts.push(
          ...chatLinesFromLayout(lines, chatCanvas.width, knownTitle || "对方"),
        );
        titleCanvas.width = titleCanvas.height = 1;
        chatCanvas.width = chatCanvas.height = 1;
      } finally {
        bitmap.close();
      }
    }
  } finally {
    await worker.terminate();
  }
  if (!parts.length)
    throw new Error("未识别到左右聊天气泡，请选择完整、清晰的微信聊天截图。");
  return parts.join("\n");
}
