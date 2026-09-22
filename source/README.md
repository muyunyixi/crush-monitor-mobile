# 开发源码

完整功能介绍、使用说明、部署、接口、隐私和排错请阅读[仓库根目录 README](../README.md)。

在本目录运行：

```bash
npm ci
node --import tsx --test tests/*.test.ts
npm run build
npx vite preview --host 127.0.0.1
```

`dist/index.html` 为发布页面；`dist/ocr/` 为截图识字所需的同源资源，必须一起部署。
