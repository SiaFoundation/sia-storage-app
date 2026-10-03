/**
 * The navigation recipes in apps/sim/FEATURES.md: fenced `sim` blocks of
 * `bun sim device ...` lines, each the way to reach one place in the phone app
 * and leave it again. Parsed here so the navigation scenario can run every
 * recipe the way a person pastes one, and the feature map test can check that
 * every label and test id a recipe names is in the mobile app's source.
 *
 * A recipe names its phone `phone`, and `{file}`, `{folder}` and `{tag}` stand
 * for things the navigation scenario sets up first.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UiSurface } from './devices/types'
import { REPO_ROOT } from './session'
import type { SwipeDirection } from './ui/driver'
import type { Selector } from './ui/tree'

const FEATURES = join(REPO_ROOT, 'apps/sim/FEATURES.md')

type RecipeStep = {
  action: string
  positional: string[]
  opts: Record<string, string | true>
  line: string
}

type Recipe = { feature: string; steps: RecipeStep[] }

/** Splits a command line into words, keeping quoted runs together. */
function words(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) {
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]))
  }
  return out
}

/** Options that take no value. */
const FLAGS = new Set(['gone', 'submit', 'clear'])

function parseStep(line: string): RecipeStep {
  const [bun, sim, device, action, target, ...rest] = words(line)
  if (bun !== 'bun' || sim !== 'sim' || device !== 'device' || target !== 'phone') {
    throw new Error(`A recipe line runs \`bun sim device <action> phone ...\`: ${line}`)
  }
  const positional: string[] = []
  const opts: Record<string, string | true> = {}
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]
    if (!word.startsWith('--')) {
      positional.push(word)
      continue
    }
    const key = word.slice(2)
    if (FLAGS.has(key)) opts[key] = true
    else opts[key] = rest[++i]
  }
  return { action, positional, opts, line }
}

/** Every `sim` block in FEATURES.md, each under the `###` heading it sits below. */
export function parseRecipes(markdown = readFileSync(FEATURES, 'utf8')): Recipe[] {
  const recipes: Recipe[] = []
  let feature = ''
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{2,4} (.+)$/.exec(lines[i])
    if (heading) feature = heading[1]
    if (lines[i].trim() !== '```sim') continue
    const steps: RecipeStep[] = []
    for (i++; i < lines.length && lines[i].trim() !== '```'; i++) {
      const line = lines[i].trim()
      if (line && !line.startsWith('#')) steps.push(parseStep(line))
    }
    recipes.push({ feature, steps })
  }
  return recipes
}

function selectorOf(opts: Record<string, string | true>): Selector | undefined {
  const sel: Selector = {}
  for (const key of ['text', 'label', 'id', 'contains'] as const) {
    if (typeof opts[key] === 'string') sel[key] = opts[key] as string
  }
  return Object.keys(sel).length > 0 ? sel : undefined
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
}

/** Runs one recipe on a phone's screen, with its placeholders filled from `vars`. */
export async function runRecipe(
  ui: UiSurface,
  recipe: Recipe,
  vars: Record<string, string>,
): Promise<void> {
  for (const step of recipe.steps) {
    const opts = Object.fromEntries(
      Object.entries(step.opts).map(([k, v]) => [k, v === true ? v : fill(v, vars)]),
    )
    const positional = step.positional.map((p) => fill(p, vars))
    const sel = selectorOf(opts)
    const need = (): Selector => {
      if (!sel) throw new Error(`No element named in: ${step.line}`)
      return sel
    }
    switch (step.action) {
      case 'tap':
        await ui.tap(need())
        break
      case 'long-press':
        await ui.longPress?.(need())
        break
      case 'type':
        await ui.type(need(), positional[0] ?? '', {
          clear: opts.clear === true,
          submit: opts.submit === true,
        })
        break
      case 'clear':
        await ui.clear(need())
        break
      case 'swipe':
        await ui.swipe?.(positional[0] as SwipeDirection, sel)
        break
      case 'scroll-to':
        await ui.scrollTo?.(need(), (opts.direction as SwipeDirection | undefined) ?? 'up')
        break
      case 'back':
        await ui.back?.()
        break
      case 'hide-keyboard':
        await ui.hideKeyboard?.()
        break
      case 'expect':
        if (opts.gone === true) await ui.waitForGone(need())
        else await ui.waitFor(need())
        break
      default:
        throw new Error(`A recipe cannot run \`${step.action}\`: ${step.line}`)
    }
  }
}
