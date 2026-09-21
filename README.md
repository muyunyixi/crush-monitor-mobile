# Crush Monitor Mobile

网页：https://muyunyixi.github.io/crush-monitor-mobile/

移动端微信风格的聊天分析页。支持整段聊天和单条消息粘贴，保留好感信号、情绪、意图、回复评级和下一步建议。

访客不填写 Key 时，同一公网 IP 每天可免费分析 10 次；填写自己的 TypeSafe API Key 后不受本站次数限制。公共 Key 仅保存在 Cloudflare Secret 中，源码不含密钥。

前端部署在 GitHub Pages，后端使用 Cloudflare Worker 与 SQLite Durable Object。完整说明见 [source/MOBILE.md](source/MOBILE.md)。

基于 FerryCorleone/crush-monitor，保留 MIT 许可。
