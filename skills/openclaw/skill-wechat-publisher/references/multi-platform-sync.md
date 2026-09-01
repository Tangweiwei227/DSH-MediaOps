<!-- Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation. -->

# 阶段七:多平台同步细节

把发到微信草稿箱的同一篇文章同步到知乎、掘金、CSDN、头条等平台，是上游可选实验能力。**DSH-MediaOps 的受控 Host adapter 不开放该路径**：它没有逐平台冻结快照、账号身份复核和独立审批，因此下面仅保留配置背景，不提供真实执行命令。

#### 前置一次性安装

底层基于 [Wechatsync](https://github.com/wechatsync/Wechatsync),复用 Chrome 扩展里各平台已登录的 Cookie,不经过任何第三方服务器。

1. 装 Chrome 扩展「Wechatsync」,并分别登录知乎 / 掘金 / CSDN 等目标平台
2. 扩展设置里打开「MCP 连接」,生成一个 Token 拷出来
3. 装 CLI:
   ```bash
   npm install -g @wechatsync/cli
   ```
4. 在 `wechat-publisher.yaml` 里配置:
   ```
   integrations:
     wechatsync_mcp_token: "<第二步拷出的 Token>"
   ```
5. 自检:
   ```bash
   python3 skills/openclaw/skill-wechat-publisher/scripts/multi_publish.py --check
   ```
   两项都打 `✓` 说明就绪。

#### 配置格式（仅上游参考）

先在 `wechat-publisher.yaml` 对应账号下加:
```yaml
accounts:
  main:
    ...
    sync_platforms: [zhihu, juejin]
```
DSH 中不得使用 `--sync`、`--sync-from-config` 或独立 `multi_publish.py` 执行。需要发布到受控的其他平台时，应为每个平台保存独立草稿，并分别走 MediaOps 预览与审批。掘金、CSDN、头条目前不在 7 个受控连接器中。

#### 图片注意事项

微信 CDN(`mmbiz.qpic.cn`)有严格防盗链,其他平台加载时会显示「此图片来自微信公众平台」占位图。
因此同步走的是**原始 markdown**(`article.md`),不是已处理过的版本。

- 外部 URL 图片(HTTPS):wechatsync 自动转存到各平台,通常没问题
- 本地路径图片（比如 `outputs/主题名/assets/fig1.png`）：wechatsync 的文档未明确是否支持
  - `multi_publish.py` 会扫出并提示有多少张本地图
  - 如果目标平台发现图加载不出来,需要把本地图先传到公开图床(或任何无防盗链的 CDN)、改成 URL 后再跑同步

#### 失败处理

- 同步失败**不回滚**微信草稿(微信草稿已在阶段六成功创建)
- 告知用户:微信草稿 OK,但某平台同步失败 → 可以登录 Chrome 扩展手动重试
- 各平台同步后都是「草稿」状态,**不会**直接公开发布,需要用户登录各平台二次确认
