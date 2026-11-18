# DSH-MediaOps 官网

这是 DSH-MediaOps 的静态官网源码，位于项目的 `website/` 目录。首页使用原生 HTML/CSS/JS；文档子页从仓库 Markdown 预渲染为静态 HTML，浏览器无需请求 GitHub 或 Markdown API。

官网地址：https://pages.xiaotangtevin.top/DSH-MediaOps/

通过 [GitHub Actions 工作流](../.github/workflows/deploy-pages.yml) 将 `website/dist/` 部署到 GitHub Pages。推送官网文件或部署配置到 `main` 时自动发布，也可在 Actions 页面手动运行。工作流会先运行官网检查，再上传并部署静态文件。仓库 Settings → Pages 的发布源应设置为 GitHub Actions。

## 文档更新

源文件与路由在 [`scripts/docs-config.mjs`](../scripts/docs-config.mjs) 中声明。使用说明、能力目录、安全、模型、更新记录与维护文档共用站内导航；Markdown 内的文档交叉链接会改写为站内页面，保留章节锚点。搜索索引随页面生成，不使用第三方搜索服务。

修改源文档或页面模板后，在仓库根目录运行：

```sh
npm ci --prefix website --ignore-scripts
npm run build --prefix website
node scripts/check-website.mjs
```

提交源文件和 `website/dist/docs/` 生成产物。CI 会在 `docs/`、安全政策、第三方来源、模板或生成脚本更新时重新生成并部署。官网检查会验证源摘要、所有子页的资源与章节链接，并拒绝跳转到 GitHub 原始 Markdown 的阅读链接。

[`website/.openai/hosting.json`](.openai/hosting.json) 保留为原 Sites 托管元数据；GitHub Pages 不使用该配置。

本地预览：

```sh
python3 -m http.server 4173 --directory website/dist
```

官网中的产品描述应与仓库当前发布版本保持一致；新增能力时，请同时更新插件说明书与官网相应章节。
