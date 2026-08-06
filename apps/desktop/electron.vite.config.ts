import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * Every entry is emitted as CommonJS.
 *
 * electron-vite defaults to ESM, which Electron's main process only partly
 * supports and which a sandboxed preload cannot load at all. An ESM entry does
 * not fail loudly: Electron starts, runs none of it, and leaves a process alive
 * with no output.
 */
const cjs = { format: 'cjs' as const, entryFileNames: '[name].js' }

/**
 * `electron` must stay a runtime require so it resolves to the built-in module.
 * Bundled instead, the npm package's installer code is what executes at
 * startup: the app appears to run, none of it does, and there is no error.
 */
const external = ['electron']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: cjs,
        external,
      },
    },
  },
})
