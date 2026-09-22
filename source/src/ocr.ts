import { createWorker, PSM } from "tesseract.js";

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
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    for (let i = 0; i < files.length; i++) {
      progress(`识别第 ${i + 1} / ${files.length} 张截图…`);
      const bitmap = await createImageBitmap(files[i]);
      try {
        if (bitmap.width * bitmap.height > 24000000)
          throw new Error("截图过长，请拆成几张再导入。");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        const result = await worker.recognize(canvas);
        parts.push(result.data.text.trim());
        canvas.width = canvas.height = 1;
      } finally {
        bitmap.close();
      }
    }
  } finally {
    await worker.terminate();
  }
  if (!parts.some(Boolean))
    throw new Error("未识别到文字，请选择清晰的文字聊天截图。");
  return parts
    .join("\n")
    .replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g, "$1");
}
