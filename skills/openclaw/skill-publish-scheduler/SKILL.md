---
name: skill-publish-scheduler
description: >-
  批量定时发布排期：管理"内容 × 平台 × 发布时间"的排期表，导入排期、查看队列、计算到期项、
  计算到期项并回填队列状态。当用户说"定时发布""批量发布""排期发布""发布队列"
  "按计划发""这几条按时间自动发""发布排期表""到点发布"时使用。调度逻辑纯脚本；真实发布必须逐项走 MediaOps Host 状态机。
layer: publish
---

<!-- Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation. -->

# 批量定时发布排期

> 管理一张排期表（内容×平台×时间），走 `scripts/publish_queue.py`（纯标准库）。本 bundled Skill 不可直接调用；脚本只计算队列和到期项。真实发布必须为每项创建审阅草稿，并分别走 `prepare → confirm → execute` 与原生审批，不能从排期脚本委派 publisher Skill。

## 输入

排期表 CSV（表头需含 `publish_at, platform, content`，可选 `title, note`）：
```csv
publish_at,platform,content,title
2026-08-01 09:00,xiaohongshu,outputs/note1,早间笔记
2026-08-01 20:00,douyin,outputs/主题名/final.mp4,晚间视频
```
或等价 JSON。

## 执行

脚本路径（相对项目根）：`skills/openclaw/skill-publish-scheduler/scripts/publish_queue.py`（各子命令 `-h`）。

```bash
Q=outputs/publish-queue/q.json
python <skill>/scripts/publish_queue.py import --file plan.csv --queue $Q   # 导入排期
python <skill>/scripts/publish_queue.py list  --queue $Q                    # 查看队列
python <skill>/scripts/publish_queue.py due   --queue $Q                    # 此刻到期项
python <skill>/scripts/publish_queue.py run   --queue $Q                    # 打印到期派发计划
# 按计划逐条完成 MediaOps 受控发布和平台对账后回填队列：
python <skill>/scripts/publish_queue.py mark  --queue $Q --id 1 --status done
```

## 到期派发流程（编排）

1. `due`/`run` 得到此刻到期项。
2. **对每条到期项**：先按平台适配内容并保存为审阅后的 MediaOps 草稿；逐项走冻结预览、明确确认、确认审批、执行审批与 Host adapter。
3. 以 MediaOps publication 为权威结果。`submitted`、`draft_created`、`scheduled` 不能标成公开成功；只读对账后再按真实结果 `mark`。
4. 需要"守护式到点触发"时，由 OpenClaw 定时任务周期性跑 `run`（本脚本只做单次到期计算，不常驻）。

## 规则

1. 本 Skill 不驱动浏览器/API，也不调用 publisher；发布只交给 MediaOps Host adapter。
2. `--now` 可覆盖当前时间用于预演（查看某时刻会发哪些），不影响真实时间。
3. 发布时间用 `YYYY-MM-DD HH:MM`；同一时刻多平台会一并到期。
4. 每条发布后务必 `mark`，避免重复发布。
5. 定时触发依赖上层（OpenClaw cron / 手动周期跑），本脚本是无状态到期计算 + 持久化队列。

## 参考来源

排期→到期计算→派发→状态回填是内容日历落地发布的标准闭环。调度与真实发布分层：
调度纯脚本（可测），发布由 MediaOps Host 的冻结载荷、账号复核、审批和执行租约负责。
