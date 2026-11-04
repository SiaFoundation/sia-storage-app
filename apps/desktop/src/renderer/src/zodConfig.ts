/*
 * Stops zod from probing for `eval` in the renderer.
 *
 * The first time a zod object schema parses, zod calls `new Function('')` to
 * see whether it can compile a faster parser. The renderer's Content Security
 * Policy blocks string evaluation, so the probe throws, zod falls back to its
 * plain parser, and Chromium reports a policy violation that the window's
 * console hook writes to the log as an error every time a window opens.
 * Allowing `'unsafe-eval'` would silence it by letting any injected string run
 * as code, so zod is told up front not to try.
 *
 * zod keeps this setting on `globalThis`, so it reaches the copy that
 * `@siastorage/core` imports. It must run before any schema parses, which is
 * why `main.tsx` imports this module first.
 */

import { config } from 'zod'

config({ jitless: true })
