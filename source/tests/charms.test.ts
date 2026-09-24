import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationCharms } from "../apps/web/src/charms";
import type { Message } from "../shared/types";

const messages = (pairs: Array<["self" | "other", string]>): Message[] =>
  pairs.map(([sender, text], index) => ({
    id: String(index),
    sender,
    text,
    timestamp: null,
    kind: "text",
  }));

test("对话彩蛋能识别连续世界观梗和双方共同词汇", () => {
  const found = conversationCharms(
    messages([
      ["other", "朕给你这项权利"],
      ["self", "权利和责任并行"],
      ["other", "大皇帝也要承担责任"],
    ]),
  );
  assert.ok(found.some((item) => item.key === "imperial"));
  assert.ok(
    found.some((item) => item.key === "echo" && item.label.includes("权利")),
  );
});

test("高比例轮流发言会获得你来我往彩蛋", () => {
  const found = conversationCharms(
    messages([
      ["other", "一"],
      ["self", "二"],
      ["other", "三"],
      ["self", "四"],
      ["other", "五"],
      ["self", "六"],
    ]),
  );
  assert.ok(found.some((item) => item.key === "rhythm"));
});
