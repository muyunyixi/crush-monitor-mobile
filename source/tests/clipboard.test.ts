import { test } from "node:test";
import assert from "node:assert/strict";
import {
  htmlClipboardToText,
  joinClipboardTexts,
  readClipboardData,
  readClipboardPaste,
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

test("微信把多条消息拆成多个剪贴板项目时会完整合并", async () => {
  const values = ["Crush：第一条", "我：第二条", "Crush：第三条"];
  const text = await readClipboardPaste({
    getData: () => values[0],
    items: values.map((value) => ({
      kind: "string",
      type: "text/plain",
      getAsString: (callback: (text: string) => void) => callback(value),
    })),
  });
  assert.equal(text, values.join("\n"));
});

test("粘贴事件只有一条时会再读取系统剪贴板中的完整记录", async () => {
  const text = await readClipboardPaste(
    { getData: () => "Crush：第一条" },
    {
      readText: async () => "Crush：第一条\n我：第二条\nCrush：第三条",
    },
  );
  assert.equal(text, "Crush：第一条\n我：第二条\nCrush：第三条");
});

test("read 返回一条时仍比较 readText 的完整文本", async () => {
  const result = await readClipboardText({
    read: async () => [
      { types: ["text/plain"], getType: async () => new Blob(["第一条"]) },
    ],
    readText: async () => "第一条\n第二条\n第三条",
  });
  assert.equal(result, "第一条\n第二条\n第三条");
});
