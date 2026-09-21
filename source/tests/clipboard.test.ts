import { test } from "node:test";
import assert from "node:assert/strict";
import { joinClipboardTexts, readClipboardText } from "../src/clipboard";

test("手机剪贴板的多个文本项会完整合并", async () => {
  const text = await readClipboardText({
    read: async () => ["第一条", "第二条", "第三条"].map((value) => ({
      types: ["text/plain"],
      getType: async () => new Blob([value]),
    })),
  });
  assert.equal(text, "第一条\n第二条\n第三条");
});

test("剪贴板文本统一换行并忽略空项目", () => {
  assert.equal(joinClipboardTexts([" 第一条\r\n第二行 ", "", " 第三条 "]), "第一条\n第二行\n第三条");
});
