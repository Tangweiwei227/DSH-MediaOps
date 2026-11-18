import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

await mkdir(new URL('../lib', import.meta.url), { recursive: true })

await build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/index.js', import.meta.url)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
})

await build({
  entryPoints: [fileURLToPath(new URL('../src/client/index.tsx', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/client.js', import.meta.url)),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: [
    'react',
    'react/jsx-runtime',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-renderer/client',
    '@deepseek-ai/dsh-client-ui-conversation/client',
    '@deepseek-ai/dsh-client-ui-input-trigger/client',
    '@deepseek-ai/dsh-client-ui-settings/client',
    '@deepseek-ai/dsh-client-ui-slots',
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-mediaops", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
})
