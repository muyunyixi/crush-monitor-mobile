import { test } from "node:test";
import assert from "node:assert/strict";
import { chatLinesFromLayout, cleanChatTitle } from "../src/ocr-layout";

test("截图版面仅保留左右对话并按方向标记双方", () => {
  const result = chatLinesFromLayout(
    [
      { text: "07:42", confidence: 92, bbox: { x0: 15, y0: 5, x1: 95, y1: 25 } },
      { text: "你通常吗", confidence: 91, bbox: { x0: 120, y0: 80, x1: 330, y1: 120 } },
      { text: "下午 3:20", confidence: 88, bbox: { x0: 430, y0: 150, x1: 570, y1: 180 } },
      { text: "这个变声器好强", confidence: 90, bbox: { x0: 510, y0: 220, x1: 920, y1: 270 } },
      { text: "+", confidence: 77, bbox: { x0: 940, y0: 880, x1: 960, y1: 900 } },
    ],
    1000,
    "Sue",
  );
  assert.deepEqual(result, ["Sue：你通常吗", "我：这个变声器好强"]);
});

test("聊天标题会过滤状态栏符号", () => {
  assert.equal(cleanChatTitle("07:42\n< Sue ···"), "Sue");
});
