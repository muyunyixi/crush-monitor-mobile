import { test } from "node:test";
import assert from "node:assert/strict";
import {
  htmlClipboardToText,
  joinClipboardTexts,
  readClipboardData,
  readClipboardText,
} from "../src/clipboard";

test("手机剪贴板的多个文本项会完整合并", async () => {
  const text = await readClipboardText({
    read: async () =>
      ["第一条", "第二条", "第三条"].map((value) => ({
        types: ["text/plain"],
        getType: async () => new Blob([value]),
      })),
  });
  assert.equal(text, "第一条\n第二条\n第三条");
});

test("剪贴板文本统一换行并忽略空项目", () => {
  assert.equal(
    joinClipboardTexts([" 第一条\r\n第二行 ", "", " 第三条 "]),
    "第一条\n第二行\n第三条",
  );
});

test("微信多选复制时优先采用包含完整消息的 HTML", () => {
  const data = {
    getData(type: string) {
      if (type === "text/plain") return "Crush：第一条";
      if (type === "text/html")
        return "<div>Crush：第一条</div><div>我：第二条</div><div>Crush：第三条&nbsp;内容</div>";
      return "";
    },
  };
  assert.equal(
    readClipboardData(data),
    "Crush：第一条\n我：第二条\nCrush：第三条 内容",
  );
});

test("微信内嵌换行符会转换为普通换行", () => {
  assert.equal(
    htmlClipboardToText("<p>第一条\u2028第二行</p><p>第三条</p>"),
    "第一条\n第二行\n第三条",
  );
});
