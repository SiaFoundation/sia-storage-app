/**
 * Decides when a run stops starting phones of one kind. A phone that cannot
 * start spends three launches of two minutes each before its scenario ends as
 * ERROR, so on a machine where the app cannot start at all, a suite of phone
 * scenarios spends an hour repeating one fault. Two scenarios in a row that
 * could not start the same kind of phone are taken to mean the next will not
 * either, and the rest that need it end at once.
 */
import type { PhoneKind } from './session'

/** What one finished scenario showed about starting phones. */
export type StartOutcome = {
  /** The phone kinds the scenario needed. */
  needs: PhoneKind[]
  /** Set when the scenario ended because a phone of `kind` could not start. */
  failed?: { kind: PhoneKind; reason: string }
}

/**
 * The phone kinds not to start again, each with the reason the first of its
 * two failed starts gave. `outcomes` is in the order the scenarios finished,
 * and a kind is judged on its last two scenarios that needed it, so a
 * scenario without that kind between two failures does not reset the count,
 * and a later start that succeeds, from a scenario that was already running,
 * does. A scenario that ended on another kind's failed start says nothing
 * about this kind and is passed over.
 */
export function unstartable(outcomes: StartOutcome[]): Map<PhoneKind, string> {
  const out = new Map<PhoneKind, string>()
  for (const kind of new Set(outcomes.flatMap((o) => o.needs))) {
    const judged = outcomes.filter(
      (o) => o.needs.includes(kind) && (!o.failed || o.failed.kind === kind),
    )
    const [first, second] = judged.slice(-2)
    if (first?.failed && second?.failed) out.set(kind, first.failed.reason)
  }
  return out
}
