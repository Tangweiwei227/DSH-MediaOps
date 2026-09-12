# Easel 上游同步与漂移检查

DSH-MediaOps 当前固定在 Easel commit `660dfd2b75d10bea48f57be22d8da694f88851b8`。固定 commit、两棵上游 Skill tree 的 Git object id、Skill 数量和 Host-only 清单记录在 `upstream/easel-snapshot.json`，避免把会移动的 branch 当成供应链输入。manifest 中的 `curatedDigest` 另行绑定 DSH 定制后的 `skills/openclaw` 与 `skills/shared`：它按 UTF-8 字节序排列相对路径，并摘要路径、文件大小和完整内容，因此本地新增、删除、重命名或修改文件都会让离线门禁失败。空目录不进入摘要（Git 也不跟踪空目录）。

## 日常检查

- `pnpm check:upstream:snapshot`：完全离线，严格比对 DSH curated 文件树摘要，并校验 snapshot 元数据、112 个 frontmatter、Host-only 清单与修改声明、NOTICE 引用和两份已识别的 vendored MIT 许可证。它属于 `pnpm check`；缺少摘要或任一文件漂移都会失败，默认命令绝不改写基线。
- `pnpm update:upstream:curated`：显式、人工使用的基线更新命令。它先通过摘要以外的全部离线安全检查，再把当前摘要原子写入 manifest，并拒绝符号链接、非普通 manifest 或并发改写。只能在逐项审阅合法的 curated 变更之后运行；不要放进自动修复、安装脚本或 CI。
- `pnpm check:upstream`：只读查询 Easel `main` 远端 commit；与 pin 不同就失败。GitHub Actions 每周运行一次。
- `pnpm report:upstream`：在独立临时 clone 中取候选 commit，比较固定 snapshot，运行候选 frontmatter lint、敏感路径/高置信秘密扫描，并将报告原子写入 `.artifacts/easel-upstream-report.md`。也可用 `--upstream /path/to/Easel --ref <commit>` 对本地 Git 对象离线生成报告；脚本不会 checkout 或改写传入仓库。候选树限制为 20,000 个文件、单文件 32 MiB、合计 256 MiB，报告输出拒绝符号链接和非普通文件。

这些命令不会修改 `skills/`，也不会把候选 commit 自动写入 pin。自动覆盖会丢失 DSH 的只读 resourceBase、workspace/data-root 路径、安全审批和 Host-only 控制，因此不提供这种模式。

## 人工采用流程

1. 在干净 review branch 生成并审阅报告；逐个合并需要的文件，而非目录覆盖。
2. 对新增或变化的外部写入路径重新做威胁建模；更新 `HOST_ONLY_SKILLS` 并验证模型与用户都不可直接调用。
3. 保留/补充 `Modified by DSH-MediaOps` 声明和原始 `EASEL-META.md`；重新核验 NOTICE、第三方许可证与商业 API 条款。
4. 检查旧 `<项目根>`、profile、Cookie/Token/.env 路径，确保产物进 workspace、秘密进 data root，安装目录保持只读。
5. 跑 Python publisher self-test、npm 包内容/秘密扫描和隔离 DSH 安装；确认 `skills/openclaw` 与 `skills/shared` 的每项 diff 都在审阅范围内。
6. 只有以上审查通过后，才运行 `pnpm update:upstream:curated`，检查生成的 manifest diff，并在同一提交更新 `upstream/easel-snapshot.json` 的 commit、tree id、数量与 curated 摘要。
7. 最后跑 `pnpm check`，并附报告/审查结论；摘要更新不能替代测试或人工审查。

回滚时恢复上一提交的 `skills/`、NOTICE 与 snapshot manifest；不要只回退 manifest，否则漂移门禁会给出错误的可信状态。
