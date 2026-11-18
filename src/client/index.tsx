import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only imports merge the official client services and slot maps into Context.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { MediaOpsWorkbench } from './MediaOpsWorkbench.tsx'
import { createActionSource, createMentionSource } from './triggers.ts'
import { ModelSettings } from './ModelSettings.tsx'

/** Stable identity of the right-Sidebar tab contributed by this plugin. */
const MEDIAOPS_SIDEBAR_TAB_ID = 'dsh-mediaops/rightbar'

/** Client services required before this plugin may mount. */
export const inject = ['slots', 'inputTriggers', 'sidebarRightTabs']

/** Register AI-native input affordances plus the full MediaOps workbench. */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.inputTriggers.registerSource(createMentionSource()),
    'dsh-mediaops: @ library source',
  )
  ctx.effect(
    () => ctx.inputTriggers.registerSource(createActionSource()),
    'dsh-mediaops: / workflow source',
  )

  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: 'mediaops',
      order: 20,
      label: 'MediaOps',
    },
    () => createElement(MediaOpsWorkbench),
  ))

  // The same control plane remains reachable without an active conversation.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'mediaops',
      order: 35,
      label: 'MediaOps',
    },
    () => createElement(MediaOpsWorkbench, { compact: true }),
  ))

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'mediaops-models',
      order: 36,
      label: '多模态模型',
    },
    () => createElement(ModelSettings),
  ))

  // Right-Sidebar entry: a page-type tab opened by kind. Stage one declares
  // the type, stage two renders the workbench body under the same id.
  ctx.effect(
    () => ctx.sidebarRightTabs.register({
      id: MEDIAOPS_SIDEBAR_TAB_ID,
      kind: 'mediaops',
      title: () => 'MediaOps',
      guide: [{
        id: 'dsh-mediaops',
        order: 10,
        title: () => 'MediaOps',
        description: () => '选题、爆款、草稿与发布队列',
      }],
    }),
    'dsh-mediaops: rightbar tab type',
  )

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: MEDIAOPS_SIDEBAR_TAB_ID,
    },
    () => createElement(MediaOpsWorkbench, { compact: true }),
  ))
}
