# Crush Monitor 移动网页版本

基于 https://github.com/FerryCorleone/crush-monitor ，源版本 c0079be18a0924fc1769cf5aa94f1d76c04791cb。保留 MIT 许可及原作者声明。

## 最简单部署（无需安装软件）

1. 在自己的 GitHub 账号新建一个公开仓库，例如 crush-monitor-mobile。
2. 解压交付 ZIP，将 `deploy` 文件夹**里面**的 index.html、assets 文件夹、favicon.svg 和 LICENSE 上传到仓库根目录。不要把整个 ZIP 上传，也不要只上传 index.html。
3. 在仓库 Settings → Pages → Build and deployment 选择 Deploy from a branch，分支 main，目录 / (root)，保存。
4. 等待 Pages 显示网址，用手机 Safari 或 Chrome 打开。地址通常是 https://你的用户名.github.io/crush-monitor-mobile/ 。
5. 右上角「…」→ 填写自己的 TypeSafe API Key。不要把 Key 放进 GitHub 文件或截图中。

## 手机上如何粘贴

- 微信长按一条文字 → 复制 → 回到网页 → 选择「单条消息」→ 选择「对方说」或「我说」→ 粘贴 → 分析聊天。依次添加即可累积上下文。
- 已有带昵称的完整记录：选择「整段记录」，粘贴并确认哪个昵称是自己。
- 手动整理也支持：
  我：周末有空吗？
  对方：下午可以，有什么安排？
- 页面不会假设纯文本中每一行都在轮流说话。多条纯文本没有身份信息时，请逐条选择身份，或补上昵称。
- 微信不同版本的多选菜单不一定支持把多条聊天复制成文本；网页版无法直接读取微信内部聊天、语音或图片。可以逐条复制文字。
- 「粘贴」按钮不可用时，长按输入框使用系统的粘贴。推荐在系统浏览器中打开。

## 与原版一致的部分

微信灰白背景、绿色我方气泡、顶部好感信号分、12 类情绪与 35 类意图的前三项、SSS 至 D 回复评级、下一步建议、关系设置、角色交换、详情窗口、增量导入与重复片段确认。继续使用原版 Jev 模型、提问模板与评分逻辑。

## GitHub Pages 与模型调用

GitHub Pages 只托管静态网页。这个版本把原来的分析编排移到浏览器，使用官方 SDK 和使用者自己输入的 Key 直接调用 TypeSafe；并非离线模型。密钥及聊天不写入 localStorage，刷新页面清空。分析会发送当前上下文，按原版分批调用，可能产生多次请求和费用。

本次已通过 TypeScript 构建及原项目 24 项单元测试。未提供真实 API Key，因此未验证实际模型返回、账号额度、TypeSafe 对 GitHub Pages 来源的跨域策略，也未在真实 iPhone/Android 微信环境中测试。若直连被 CORS 或网络阻止，需要下面的自建服务；不能仅靠 GitHub Pages 设置解决。

## 直连受限时：可选自建 Worker

源码内附 `worker/index.ts` 和 `wrangler.toml`，继续复用原版分析逻辑，不用伪造分数。

1. 在 `source` 目录执行 `npm ci`。
2. 把 wrangler.toml 中 ALLOWED_ORIGIN 改为 Pages 的 origin，例如 https://你的用户名.github.io（不带仓库路径、末尾斜杠）。
3. 安装并登录 Cloudflare Wrangler，运行 `npx wrangler deploy`。
4. 在网页设置 → 连接设置中填入 https://你的-worker地址/api/analyze 。

Worker 使用每次请求携带的个人 Key，不内置公共 Key，不记录聊天。只允许配置的网页 origin。Origin 校验不是身份认证；不要改成服务器共享密钥并直接公开。自建服务会接收 Key 和聊天，仅使用自己控制或信任的地址。

## 源码部署方式

`source` 是完整修改后源码，保留原始 Node 服务文件以便参考；移动版默认不会调用本机服务。
把 source 内的文件（含 .github）提交到仓库，Settings → Pages → Source 选 GitHub Actions。附带流程会安装依赖、测试、构建并发布 dist。
本地开发：npm ci，然后 npx vite --host 127.0.0.1。
构建：npm run build。
测试：node --import tsx --test tests/*.test.ts。

## 分析含义

评分只是对文字中互动信号的模型解读，不是对方喜欢你的概率，也不能确定他人的真实想法。聊天不完整时尤其需要结合现实沟通判断。
