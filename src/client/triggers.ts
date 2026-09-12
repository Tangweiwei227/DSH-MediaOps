import type {
  InputTriggerCandidate,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { fetchReference, fetchReferences } from './api.ts'
import type { LibraryReference, ReferenceItem } from './contracts.ts'
import { parseLibraryReference } from './contracts.ts'

export const MENTION_SOURCE = 'mediaops-library'
export const ACTION_SOURCE = 'mediaops-actions'

function compact(value: string | undefined, limit = 100): string | undefined {
  if (value === undefined) return undefined
  const oneLine = value.replace(/\s+/gu, ' ').trim()
  if (oneLine === '') return undefined
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine
}

function encodeReference(reference: LibraryReference): string {
  return JSON.stringify(reference)
}

function safeClipboardLabel(value: string): string {
  return value.replace(/[\[\]()\r\n]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 160) || '未命名内容'
}

function clipboardReference(reference: LibraryReference): string {
  const label = safeClipboardLabel(reference.label)
  return `@[${label}](dsh-mediaops:${reference.kind}:${encodeURIComponent(reference.id)})`
}

const REFERENCE_SECTIONS: Record<ReferenceItem['kind'], string> = {
  topic: '选题库',
  viral: '爆款库',
  draft: '草稿库',
  publication: '发布记录',
}

function referenceCandidates(items: ReferenceItem[]): InputTriggerCandidate[] {
  return items.slice(0, 16).map((item) => {
    const description = compact(item.description)
    const hint = compact(item.hint, 120)
    return {
      name: item.label,
      ...(description === undefined ? {} : { description }),
      ...(hint === undefined ? {} : { hint }),
      section: REFERENCE_SECTIONS[item.kind],
      value: encodeReference({ kind: item.kind, id: item.id, label: item.label }),
    }
  })
}

/** `@` source: search all four libraries once and serialize the selected record at submit time. */
export function createMentionSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: MENTION_SOURCE,
    order: 30,
    showGroupTitle: false,
    async candidates(_session, { query, signal }) {
      try {
        const items = await fetchReferences(query, signal)
        return signal.aborted ? [] : referenceCandidates(items)
      } catch {
        // Trigger suggestions are optional UI affordances; keep typing usable.
        return []
      }
    },
    onPick({ candidate }) {
      const reference = parseLibraryReference(candidate.value)
      if (reference === undefined) return undefined
      return {
        insert: {
          source: MENTION_SOURCE,
          ref: encodeReference(reference),
          label: reference.label,
          clipboardText: clipboardReference(reference),
        },
      }
    },
    codec: {
      clipboardText(ref) {
        const reference = parseLibraryReference(ref)
        return reference === undefined ? '@[MediaOps 引用无效](dsh-mediaops:invalid)' : clipboardReference(reference)
      },
      async serialize(ref, signal) {
        const reference = parseLibraryReference(ref)
        if (reference === undefined) throw new Error('MediaOps 引用已损坏，请删除后重新选择')
        return fetchReference(reference.kind, reference.id, signal)
      },
    },
  }
}

interface QuickAction {
  id: string
  name: string
  description: string
  prompt: string
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'discover',
    name: '拉取今日爆款',
    description: '扫描指定平台热榜，分析可复用结构并保存到爆款库',
    prompt: '请用 DSH-MediaOps 拉取今天的热门内容，按平台、热度和内容结构整理；先给我候选清单，得到我确认后把选中的内容保存到爆款库。',
  },
  {
    id: 'promote',
    name: '爆款整理成选题',
    description: '从爆款库提炼受众、钩子、角度和平台打法',
    prompt: '请搜索 DSH-MediaOps 爆款库，找出值得跟进的内容，去重并提炼为可执行选题；展示来源关系，得到我确认后写入选题库。',
  },
  {
    id: 'create',
    name: '基于选题创作',
    description: '从选题库选择内容，按目标平台生成草稿',
    prompt: '请让我从 DSH-MediaOps 选题库选择一个选题，然后根据目标平台生成内容草稿；保留选题来源与版本，先审稿，不要直接发布。',
  },
  {
    id: 'publish',
    name: '审核并发布',
    description: '检查草稿和账号状态，生成发布预览并等待明确确认',
    prompt: '请打开 DSH-MediaOps 待发布草稿，先做平台规范检查并生成发布预览（平台、账号、标题、正文、素材、定时和幂等键）；只有在我明确确认发布后才执行。',
  },
  {
    id: 'review',
    name: '今日内容盘点',
    description: '汇总选题、草稿、发布结果和待处理事项',
    prompt: '请汇总 DSH-MediaOps 今天新增的爆款、选题、草稿和发布记录，指出阻塞项、风险与下一步优先级。',
  },
]

function actionCandidate(action: QuickAction): InputTriggerCandidate {
  return {
    name: action.name,
    description: action.description,
    section: 'DSH-MediaOps',
    value: action.id,
  }
}

/** `/` source: inserts editable, safety-aware natural-language workflows. */
export function createActionSource(): InputTriggerSource {
  return {
    trigger: '/',
    name: ACTION_SOURCE,
    order: 40,
    showGroupTitle: false,
    async candidates(_session, { query, position, signal }) {
      if (signal.aborted || position !== 'leading') return []
      const needle = query.trim().toLocaleLowerCase()
      return QUICK_ACTIONS
        .filter((action) => needle === '' || `${action.name} ${action.description} ${action.id}`.toLocaleLowerCase().includes(needle))
        .map(actionCandidate)
    },
    onPick({ candidate }) {
      const action = QUICK_ACTIONS.find((item) => item.id === candidate.value)
      return action === undefined ? undefined : { text: action.prompt, continue: true }
    },
  }
}
