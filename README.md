# 好感监控器：网页、小程序与共用后端

[网页版在线体验](https://muyunyixi.github.io/crush-monitor-mobile/) · [网页版功能](source/apps/web/README.md) · [小程序开发状态](source/apps/miniprogram/README.md) · [开发与发布](docs/开发与发布.md)

本仓库是完整项目的源码入口，包含网页、小程序和两端共用的 Cloudflare Worker。网页是已提供的补充入口；小程序处于正式版开发和验收阶段。小程序 v0.4.2 的截图识字已通过真机测试，**这不代表正式版分析、长图、彩蛋和视觉要求已经全部完成或上线**。

分析结果仅反映所选聊天文字中的信号，不代表任何人的真实想法，也不等于真实好感概率。用户主动使用识字时，截图经 Worker 转交微信 OCR；主动分析时，所选文字经 Worker 转交模型服务。本机记录不会自动云备份。

## 项目结构

```text
source/
├── apps/
│   ├── web/           React 网页前端
│   └── miniprogram/   原生微信小程序前端（可直接导入开发者工具）
├── worker/            两端共用的 Cloudflare Worker
├── shared/            网页及后端共用的标签、协议和领域规则
├── server/            网页本地服务及 Worker 使用的分析实现
├── tests/             网页与 Worker 测试
├── wrangler.toml      生产 Worker 配置
└── package.json       网页构建和项目测试
docs/                  需求规范、接口与发布说明
.github/workflows/      网页＋Worker 发布、小程序独立检查
index.html, ocr/       GitHub Pages 生成文件
```

## 一次下载后开始开发

```bash
git clone https://github.com/muyunyixi/crush-monitor-mobile.git
cd crush-monitor-mobile/source
npm ci
npm test
npm run build
npm run dev
```

需要 Node.js 22.12 或以上。网页源码位于 `source/apps/web/`，构建输出为 `source/dist/`；用微信开发者工具导入 `source/apps/miniprogram/` 即可查看小程序。下载本仓库无需去原小程序仓库补后端代码。要部署到自己的账号，还需要准备自己的 Cloudflare、微信小程序和模型服务凭据，按[开发与发布说明](docs/开发与发布.md)设置域名、Secret、Durable Object 与发布流程。

## 两端与后端

网页调用 `/api/analyze` 和 `/api/quota`；小程序正式版开发分支调用 `/api/mini/analyze` 和异步 OCR。Worker 保留 v0.4.2 旧 OCR 查询方式。网页分析按原有公网 IP 额度运行，小程序 OCR 按微信用户额度运行；小程序分析按每个微信用户每天 10 次独立计算，额度写在 `source/wrangler.toml`，随 Worker 发布。发布 Worker 时必须检查两端的兼容结果；同一个生产 Worker 只由本仓库发布。

`main` 的网页或后端变动通过 GitHub Actions 测试并部署 Worker 和网页；只修改小程序会运行小程序检查，不会覆盖生产后端。开发分支可持续提交；正式合并与部署前仍需完成微信开发者工具、真机和线上兼容验收。

## 许可证与来源

项目采用 [MIT License](LICENSE)。网页最初基于 [FerryCorleone/crush-monitor](https://github.com/FerryCorleone/crush-monitor) 的思路继续开发。本项目与微信及腾讯公司无隶属关系。
