# Crush Monitor 移动网页版本

基于 https://github.com/FerryCorleone/crush-monitor ，源版本 c0079be18a0924fc1769cf5aa94f1d76c04791cb。保留 MIT 许可及原作者声明。

## 最简单部署（无需安装软件）

1. 在自己的 GitHub 账号新建一个公开仓库，例如 crush-monitor-mobile。
2. 解压交付 ZIP，将 `deploy` 文件夹**里面**的 index.html、favicon.svg、.nojekyll 和 LICENSE 上传到仓库根目录。不要把整个 ZIP 上传。
3. 在仓库 Settings → Pages → Build and deployment 选择 Deploy from a branch，分支 main，目录 / (root)，保存。
4. 等待 Pages 显示网址，用手机 Safari 或 Chrome 打开。地址通常是 https://你的用户名.github.io/crush-monitor-mobile/ 。
5. 先部署下文的转发服务，再在右上角「…」填写转发地址和自己的 TypeSafe API Key。不要把 Key 放进 GitHub 文件或截图中。

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

GitHub Pages 只托管静态网页。TypeSafe 不接受当前网页来源的跨域直连，因此分析必须经过你控制的后端转发服务。网页不再直接请求 TypeSafe，连接失败会停止剩余分析任务。

Key 和聊天只保存在页面内存中，刷新后清空。分析时会发送给你配置的转发服务，再由服务调用 TypeSafe。只填写自己控制或信任的服务地址。

## 部署转发服务（必需）

源码包含 Cloudflare Worker `worker/index.ts`、可直接上传的 `worker/worker.bundle.mjs` 和 `wrangler.toml`。服务继续复用原版模型与分析逻辑。

1. 在 source 目录执行 `npm ci`。
2. wrangler.toml 的 ALLOWED_ORIGIN 已设为 https://muyunyixi.github.io 。更换 Pages 账号时需相应修改，不含仓库路径。
3. 在自己的 Cloudflare 账号登录 Wrangler，运行 `npx wrangler deploy`。
4. 在网页右上角设置填写 https://你的-worker地址/api/analyze 和个人 TypeSafe API Key。

Worker 不内置公共 Key，不主动记录聊天。Origin 校验不能代替身份认证，不应在此公开服务中放置共享密钥。

## 构建与发布

仓库根目录是编译后的网页，source 目录是源码。修改源码后运行 `npm ci`、`npm run build`，把 dist 中的 index.html、favicon.svg、LICENSE 和 .nojekyll 复制到仓库根目录。Pages 使用 main 分支根目录。

本地开发：`npx vite --host 127.0.0.1`。
测试：`node --import tsx --test tests/*.test.ts`。

已通过 TypeScript 构建及 28 项测试，覆盖缺少转发地址时不发送请求、跨域预检及错误响应。真实模型调用必须在后端部署后另行验证；测试通过不代表服务已经上线。

## 分析含义

评分只是对文字中互动信号的模型解读，不是对方喜欢你的概率，也不能确定他人的真实想法。聊天不完整时尤其需要结合现实沟通判断。
