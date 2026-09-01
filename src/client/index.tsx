import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only imports merge the official client services and slot maps into Context.
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MediaOpsWorkbench } from './MediaOpsWorkbench.tsx'
import { createActionSource, createMentionSource } from './triggers.ts'

/** Client services required before this plugin may mount. */
export const inject = ['slots', 'inputTriggers']

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
}
