# 开发源码

完整功能介绍、使用说明、部署、接口、隐私和排错请阅读[仓库根目录 README](../README.md)。

网页前端在 `apps/web/`，小程序在 `apps/miniprogram/`，共用 Worker 在 `worker/`。部署与接口兼容详见[开发与发布](../docs/开发与发布.md)。

在本目录运行：

```bash
npm ci
npm test
npm run build
npx vite preview --host 127.0.0.1
```

`dist/index.html` 为发布页面；`dist/ocr/` 为截图识字所需的同源资源，必须一起部署。
