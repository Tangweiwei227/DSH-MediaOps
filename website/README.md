# DSH-MediaOps 官网

这是 DSH-MediaOps 的静态官网源码，位于项目的 `website/` 目录，无需构建步骤。

官网地址：https://pages.xiaotangtevin.top/DSH-MediaOps/

通过 [GitHub Actions 工作流](../.github/workflows/deploy-pages.yml) 将 `website/dist/` 部署到 GitHub Pages。推送官网文件或部署配置到 `main` 时自动发布，也可在 Actions 页面手动运行。工作流会先运行官网检查，再上传并部署静态文件。仓库 Settings → Pages 的发布源应设置为 GitHub Actions。

[`website/.openai/hosting.json`](.openai/hosting.json) 保留为原 Sites 托管元数据；GitHub Pages 不使用该配置。

本地预览：

```sh
python3 -m http.server 4173 --directory website/dist
```

官网中的产品描述应与仓库当前发布版本保持一致；新增能力时，请同时更新插件说明书与官网相应章节。
