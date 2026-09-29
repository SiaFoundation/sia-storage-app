import { parseRecipes, runRecipe } from '../../src/recipes'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'every recipe in FEATURES.md reaches its place on the phone and leaves it again',
  description:
    'The phone imports a few files. Each recipe in apps/sim/FEATURES.md runs from the library screen, with its own file, folder and tag, and ends back on the library, so every place the map describes is reachable and leavable by the labels it names. A recipe that fails restarts the app before the next one, so one broken recipe does not hide the rest.',
  devices: { phone: 'phone' },
  timeoutMs: 25 * 60_000,
  async run({ devices, seed, step, check, note, capture }) {
    const { phone } = devices
    const recipes = parseRecipes()
    const seeded = await step('phone imports a file for each recipe', async () =>
      (await seed('phone', { count: recipes.length, size: 1024, prefix: 'recipe' })).map(
        (f) => f.name,
      ),
    )
    let ui = phone.ui()
    for (const [i, recipe] of recipes.entries()) {
      const vars = { file: seeded[i], folder: `folder-${i}`, tag: `tag-${i}` }
      // A recipe that leaves the phone off the library fails here, rather
      // than charging its failure to the next recipe.
      const error = await runRecipe(ui, recipe, vars)
        .then(() => ui.waitFor({ label: 'Menu' }))
        .then(
          () => null,
          (e: unknown) => (e instanceof Error ? e.message : String(e)),
        )
      check(
        `${recipe.feature}: recipe ${i + 1} reaches its place and returns`,
        error === null,
        error ?? undefined,
      )
      if (error) {
        note(`recipe ${i + 1} (${recipe.feature}) stopped at: ${error}`)
        // The failure screenshot is taken after the last recipe, which shows
        // the library, so each failed recipe saves the phone as it stopped.
        await capture(`recipe-${i + 1}`, ['phone']).catch(() => {})
        await ui.close()
        await phone.stop()
        await phone.start()
        ui = phone.ui()
      }
    }
    await ui.close()
  },
})
