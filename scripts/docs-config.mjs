import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const documents = [
  { slug: '', file: 'docs/GETTING_STARTED.zh-CN.md', title: '开始使用', description: '安装 MediaOps，在对话中完成你的第一篇内容草稿。' },
  { slug: 'manual', file: 'docs/PLUGIN_MANUAL.zh-CN.md', title: '插件说明书', description: '资料引用、工作台、创作与发布的完整使用说明。' },
  { slug: 'capabilities', file: 'docs/CAPABILITIES.md', title: '能力目录', description: '按你要完成的任务，查找 112 项内容运营能力。' },
  { slug: 'models', file: 'docs/MULTIMODAL_MODELS.md', title: '模型配置', description: '配置图像、视频、音乐和语音服务，完成第一次生成。' },
  { slug: 'safety', file: 'docs/SAFETY.zh-CN.md', title: '安全与隐私', description: '核对发布结果，保护本机资料、账号和模型凭证。' },
  { slug: 'updates', file: 'docs/RELEASE_NOTES_0.2.0.md', title: '更新记录', description: '了解 MediaOps 0.2 的新增能力和当前限制。' },
  { slug: 'architecture', file: 'docs/ARCHITECTURE.md', title: '技术架构', technical: true, description: '了解插件的客户端、执行端、数据与审批边界。' },
  { slug: 'upstream', file: 'docs/UPSTREAM_SYNC.md', title: '上游同步', technical: true, description: '维护者使用的 Skill 快照与漂移检查说明。' },
  { slug: 'roadmap', file: 'docs/ISSUE_TRIAGE_2026-09-12.md', title: '规划与可行性', technical: true, description: '历史可行性审查与后续实现边界。' },
  { slug: 'security-policy', file: 'SECURITY.md', title: '完整安全政策', technical: true, description: '支持版本、安全问题报告渠道与范围。' },
  { slug: 'attribution', file: 'THIRD_PARTY_NOTICES.md', title: '第三方来源', technical: true, description: '随插件分发的能力来源、许可证和致谢。' },
  { slug: 'license', file: 'LICENSE', title: '开源许可证', technical: true, plain: true, description: 'DSH-MediaOps 随附的 Apache License 2.0 原文。' },
  { slug: 'notice', file: 'NOTICE', title: '来源声明', technical: true, plain: true, description: '项目分发、上游来源和权利声明原文。' },
]

// The check can detect stale generated pages without installing the renderer.
export async function docsDigest() {
  const hash = createHash('sha256')
  const files = [...documents.map(item => item.file), 'scripts/build-docs.mjs', 'scripts/docs-config.mjs', 'website/templates/docs.html', 'website/package-lock.json']
  for (const file of files) hash.update(file).update('\0').update(await readFile(resolve(root, file))).update('\0')
  return hash.digest('hex')
}
