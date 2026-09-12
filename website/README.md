# DSH-MediaOps 官网

这是 DSH-MediaOps 的静态官网源码。部署入口由 [`website/.openai/hosting.json`](.openai/hosting.json) 指定为 `dist/`，无需构建步骤。

本地预览：

```sh
python3 -m http.server 4173 --directory website/dist
```

官网中的产品描述应与仓库当前发布版本保持一致；新增能力时，请同时更新插件说明书与官网相应章节。
