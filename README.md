# Crush Monitor Mobile · 好感监控器移动版

面向手机浏览器的聊天分析工具，基于 [FerryCorleone/crush-monitor](https://github.com/FerryCorleone/crush-monitor) 开发。保留微信风格的聊天气泡，支持聊天导入、情绪和意图分析、回复评价，以及本地对话彩蛋。

[在线体验](https://muyunyixi.github.io/crush-monitor-mobile/) · [上游项目](https://github.com/FerryCorleone/crush-monitor) · [MIT 许可证](LICENSE)

> 分数描述模型在这段文字中识别到的信号，不是对方喜欢你的概率。请结合真实交流理解结果。

## 功能

- 整段 / 单条输入：关系状态、文本编辑和身份确认在一个窗口完成。
- 剪贴板兼容：比较纯文本、HTML 和多个文本项目；按光标位置粘贴，不覆盖整份草稿。
- **截图识字**：浏览器本地识别中文和英文，支持一次选择最多 6 张截图；图片不会上传到分析接口。
- **TXT 导入**：读取 UTF-8 文本文件，绕开手机剪贴板截断。
- 情绪、意图、好感信号、回复评级及下一步建议。
- 会话内恢复：当前标签页的聊天暂存在 sessionStorage，刷新后恢复文字；分析结果和个人 Key 不持久化。
- 14 类对话彩蛋：御前频道、月下信号、同频笑点、你来我往、默契回声、夜航记录、饭搭子、共享歌单、毛茸茸频道、未来便签、善意回声、书页之间、双人副本、同一片天气。按聊天内容触发，本地计算，不消耗模型次数。
- 服务端每日额度：未填写个人 Key 时，同一公网 IP 每天 10 个分析批次；填写有效个人 Key 后不受本站免费次数限制，仍受供应商额度约束。

## 使用

1. 选择“整段记录”，点击输入框打开导入窗口。
2. 选择当前关系，粘贴文字，或点击“截图识字”“导入 TXT”。
3. 核对文本、消息数量和发送方；无昵称时可逐条切换“我 / 对方”。
4. 点击“开始分析”。点击消息标签或底部评分查看详情。
5. 右上角进入聊天设置，修改后点击“保存设置”。

推荐文本格式：

```text
Crush：你一人做事一人当吧
我：权利和责任并行
Crush：哎确实 但唠朕的权利会不会不太好
我：早晚ai会让灵气复苏的，到时候穿越了，我愿意辅助你做胶东的大皇帝，能力仅限于此
Crush：你既然享有被朕教导的权利，就负起自己担当的责任吧
```

### 微信多条复制只出现一条

网页只能读取浏览器实际开放的剪贴板内容。部分手机微信 / 系统 / 浏览器组合只提供第一条；模拟剪贴板测试不能证明所有真机均已兼容，本项目不承诺恢复未开放的内容。

可靠替代入口：在微信截取需要的文字聊天 → 在本应用选择“截图识字” → 核对识别文字和发送方。也可将完整记录整理为 UTF-8 `.txt` 后导入。普通粘贴仍可使用；“读取剪贴板”按钮会额外比较系统提供的文本表示。

### 截图识字限制

- 首次使用需要从本站加载 OCR 引擎和语言数据，可能较慢；使用 HTTPS 页面。
- 最多 6 张，每张最多 12 MB、2400 万像素，按文件选择顺序处理。
- OCR 不保证准确，不自动可靠推断左右发送方；请删除昵称栏、时间、图片内文字及重复截图内容，并校正消息边界。
- 识字本身不扣次数；只有确认后的文字发送给分析服务。
- 下载后双击 `index.html` 可显示前端，但 OCR 必须通过 HTTP(S) 运行并同时提供 `ocr/` 资源。

## 架构与目录

前端（GitHub Pages）通过 HTTPS 请求 Cloudflare Worker；Worker 验证来源并使用 TypeSafe 模型服务。Durable Object 保存每日额度与分析批次标识，刷新网页不能重置额度。

| 路径 | 用途 |
| --- | --- |
| `index.html` | 自动构建的发布页面，不手工修改 |
| `ocr/` | Actions 从锁定依赖复制的 OCR 运行资源 |
| `source/src/` | React 前端、剪贴板、OCR、彩蛋 |
| `source/shared/` | 类型、解析、评分规则 |
| `source/worker/` | Worker API、跨域与额度 |
| `source/tests/` | 回归测试 |
| `.github/workflows/pages.yml` | Worker 部署、测试、构建和发布 |

## 本地开发

需要 Node.js 22.12+、npm。

```bash
git clone https://github.com/muyunyixi/crush-monitor-mobile.git
cd crush-monitor-mobile/source
npm ci
```

创建本地 `.env`，指定已部署 Worker：

```dotenv
VITE_ANALYSIS_ENDPOINT=https://api.example.com
```

```bash
npx vite --host 127.0.0.1
node --import tsx --test tests/*.test.ts
npm run build
npx vite preview --host 127.0.0.1
```

生产预览包含 `dist/ocr/`，截图识字请在生产预览验证。模型 Key 不得使用 `VITE_` 前缀或写入前端源码。

## 部署到 GitHub Pages + Cloudflare

1. Fork 仓库，启用 Actions。Pages 选择从 `main` 分支根目录发布。
2. 修改 `source/wrangler.toml` 的 Worker 名称及 `ALLOWED_ORIGIN`（前端域名的 origin，无路径）。保留 `USAGE_LIMITER` Durable Object 绑定和迁移。
3. 在 GitHub Actions Secrets 设置 `CLOUDFLARE_API_TOKEN`。Fork 时将工作流的 `accountId` 改为自己的账户，建议使用 `${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` 并设置对应 Secret；当前工作流保留本仓库部署账户。
4. 在 Cloudflare Worker 设置 Secret `TYPESAFE_API_KEY`，用作公共分析 Key；已设置的无需重复添加。
5. 在 GitHub Actions Variables 设置 `PUBLIC_WORKER_URL=https://api.example.com`。不填写时工作流使用 Wrangler 的部署 URL。
6. 自定义 API 域名须先在 Worker 的 Custom Domains 中绑定。更新 URL 后重新运行工作流。
7. 推送代码或手动运行 “Deploy Worker and mobile web”。工作流部署 Worker、检查 `/health`、运行测试、构建，再发布 `index.html` 和 `ocr/`。等待最终 Pages 工作流成功。

注意：Fork 后还应修改工作流健康检查的 `Origin`。CORS 来源与前端实际域名必须一致。自定义域名不能保证所有网络都可稳定直连。

## 接口与额度

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/health` | GET | Worker 存活检查，不代表模型调用成功 |
| `/api/quota` | GET | 查询剩余免费次数，不扣次数 |
| `/api/analyze` | POST | 分析请求，按同一批次标识去重计次 |

免费额度按 **UTC 日期**重置（北京时间 08:00），共享公网 IP 的用户共享额度。刷新会查询真实额度。上游失败的已提交批次可能仍占用一次免费额度。不得对 API 路径配置浏览器交互挑战，否则 fetch 无法完成。

## 隐私

- 个人 Key 只在页面内存中，刷新清空；分析时经 Worker 转发给模型供应商。
- 聊天文字暂存在当前标签页的 sessionStorage；“清空聊天”会移除。浏览器的恢复会话功能可能恢复标签页数据，不能把关闭窗口视为可靠删除。
- 模型分析会发送聊天文本到 Worker 和 TypeSafe。截图 OCR 在浏览器本地执行，图片不会发送给模型；语言资源可能被浏览器缓存。
- 不要将真实聊天、Key、部署令牌提交到仓库或公开 issue。

## 已知边界与排错

- 未将上游 v1.1.0 的六维评分、无限历史和 IndexedDB 分析持久化整体移植；移动版维护自己的前后端协议。
- 长记录超过分析范围会要求裁剪确认；OCR 不会绕过分析长度限制。
- 只看到空白：确认打开的是发布根目录构建文件，不能双击 `source/index.html`。
- 仍是旧界面：重新打开线上 URL，检查最新 Actions 和 Pages 是否都成功。
- CORS / Failed to fetch：检查 Worker 域名、`ALLOWED_ORIGIN`、TLS 和网络；不要直连 TypeSafe 官方 API。
- 429：查看聊天区系统提示，等待额度重置或使用自己的有效 Key。
- OCR 加载失败：确认发布目录含 `ocr/worker.min.js`、WASM 与两个语言文件，检查网络和浏览器 WebAssembly 支持。

## 贡献与许可

欢迎提交可复现问题和 Pull Request。问题请附手机系统、微信版本、浏览器版本、脱敏示例及预期 / 实际行为。修改源码后运行测试与生产构建，不手工编辑生成文件。

本项目采用 [MIT](LICENSE)；保留原作者版权和许可。感谢 [FerryCorleone/crush-monitor](https://github.com/FerryCorleone/crush-monitor)。本项目不是微信官方产品，与腾讯无隶属关系。OCR 使用 [Tesseract.js](https://github.com/naptha/tesseract.js) 和相应语言数据，遵循各自许可证。
