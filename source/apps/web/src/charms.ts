import type { Message } from "../../../shared/types";

export type ConversationCharm = {
  key: string;
  icon: string;
  label: string;
  detail: string;
};

function has(messages: Message[], sender: Message["sender"], pattern: RegExp) {
  return messages.some(
    (message) => message.sender === sender && pattern.test(message.text),
  );
}

function sharedPhrase(messages: Message[]) {
  const phrases = (sender: Message["sender"]) => {
    const found = new Set<string>();
    for (const message of messages.filter((item) => item.sender === sender)) {
      const text = message.text.replace(
        /[\s，。！？、：；,.!?:;~～“”"'（）()\[\]]/g,
        "",
      );
      for (let size = 4; size >= 2; size--)
        for (let index = 0; index <= text.length - size; index++)
          found.add(text.slice(index, index + size));
    }
    return found;
  };
  const self = phrases("self");
  const other = phrases("other");
  const ignored =
    /^(我们|你们|他们|这个|那个|就是|可以|不是|什么|怎么|一个|一下|然后|但是|因为|所以|真的|觉得)$/;
  return [...self]
    .filter((phrase) => other.has(phrase) && !ignored.test(phrase))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
}

export function conversationCharms(messages: Message[]) {
  const charms: ConversationCharm[] = [];
  const add = (charm: ConversationCharm) => charms.push(charm);
  if (
    messages.filter((message) => /朕|大皇帝|灵气复苏/.test(message.text))
      .length >= 2
  )
    add({
      key: "imperial",
      icon: "👑",
      label: "御前频道",
      detail: "这段聊天建立了自己的世界观，角色梗已经接成连续剧情。",
    });
  if (messages.some((message) => /月亮|月光|月色|星河|星星/.test(message.text)))
    add({
      key: "moon",
      icon: "🌙",
      label: "月下信号",
      detail: "聊天里捕捉到月亮或星光意象，解锁了一枚夜航徽章。",
    });
  if (
    has(messages, "self", /哈{2,}|h{2,}/i) &&
    has(messages, "other", /哈{2,}|h{2,}/i)
  )
    add({
      key: "laugh",
      icon: "😄",
      label: "同频笑点",
      detail: "双方都留下了明显的笑声标记，这一段的节奏比较轻松。",
    });
  if (messages.length >= 6) {
    const changes = messages
      .slice(1)
      .filter(
        (message, index) => message.sender !== messages[index].sender,
      ).length;
    if (changes / (messages.length - 1) >= 0.8)
      add({
        key: "rhythm",
        icon: "🏓",
        label: "你来我往",
        detail: "消息轮次切换很均衡，像一场没有掉拍的接球。",
      });
  }
  const phrase = sharedPhrase(messages);
  if (phrase)
    add({
      key: "echo",
      icon: "🔁",
      label: `默契回声 · ${phrase}`,
      detail: `“${phrase}”被双方都使用过，它已经悄悄成为这段对话的共同词汇。`,
    });
  if (
    messages.some((message) =>
      /(?:^|\D)(?:0?[0-4]):[0-5]\d/.test(message.timestamp ?? ""),
    )
  )
    add({
      key: "night",
      icon: "🕯️",
      label: "夜航记录",
      detail:
        "记录里出现了深夜时刻；夜深时的语气容易被放大，判断时值得多留一点余量。",
    });
  const pairs: Array<[string, string, string, RegExp, string]> = [
    [
      "food",
      "🍜",
      "饭搭子频道",
      /吃|饭|奶茶|火锅|面条/,
      "双方都聊到了吃喝，记录里有共同的话题入口。",
    ],
    [
      "music",
      "🎵",
      "共享歌单",
      /歌|音乐|旋律|耳机/,
      "音乐在双方的话里出现了。记下歌名，下次就有一个具体话题。",
    ],
    [
      "cat",
      "🐾",
      "毛茸茸频道",
      /猫|狗|喵|汪|宠物/,
      "双方都提到了小动物，这是一枚毛茸茸的话题徽章。",
    ],
    [
      "plan",
      "🗓️",
      "未来便签",
      /下次|明天|周末|改天/,
      "双方都提到了未来时间；有具体安排才算约定，先记成便签。",
    ],
    [
      "thanks",
      "🌿",
      "善意回声",
      /谢谢|辛苦|感谢/,
      "双方都表达了感谢或体谅，值得留意这些小小的善意。",
    ],
    [
      "book",
      "📚",
      "书页之间",
      /书|读|诗|小说/,
      "双方的话里都出现了阅读相关词语，留下一枚书签。",
    ],
    [
      "game",
      "🎮",
      "双人副本",
      /游戏|开黑|副本|组队/,
      "双方都提到了游戏话题，日常兴趣正在交汇。",
    ],
    [
      "weather",
      "☁️",
      "同一片天气",
      /雨|晴|天气|风|雪/,
      "双方都在谈天气，平常的小话题也可以接住。",
    ],
  ];
  for (const [key, icon, label, pattern, detail] of pairs)
    if (has(messages, "self", pattern) && has(messages, "other", pattern))
      add({ key, icon, label, detail });
  return charms;
}
