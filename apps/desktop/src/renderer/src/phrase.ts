/*
 * Recovery phrase text, as the twelve-slot field needs it.
 *
 * A phrase fails two ways. A word outside the 2048-word list is wrong on sight
 * and is caught here while the field has focus. A phrase of real words with a
 * bad checksum can only be caught by the SDK, so that verdict comes from the
 * daemon once all twelve are filled. The list is imported for its words alone:
 * nothing here derives a key or decides whether a phrase is accepted.
 */

import { wordlist } from '@scure/bip39/wordlists/english.js'

export const WORD_COUNT = 12

const WORDS = new Set(wordlist)

/** How many suggestions the field can show without covering the slots below it. */
const SUGGESTION_LIMIT = 5

export type WordStatus = 'empty' | 'known' | 'partial' | 'unknown'

/** Lower-cases and drops anything that is not a letter, since no BIP-39 word contains one. */
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Splits pasted text into words. Phrases get copied out of password managers
 * and numbered lists, so digits and punctuation are separators here rather than
 * characters that make a word unrecognizable.
 */
export function splitPhrase(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
}

/** Writes `words` into `slots` starting at `start`, ignoring anything past the last slot. */
export function fillFrom(slots: readonly string[], start: number, words: readonly string[]) {
  const next = [...slots]
  for (let i = 0; i < words.length && start + i < next.length; i++) {
    next[start + i] = words[i] as string
  }
  return next
}

/**
 * `partial` is what a half-typed word looks like: still the prefix of a real
 * word, so marking it wrong mid-keystroke would flash red on every entry.
 * Once the slot loses focus a prefix is marked even though it could still be
 * completed: submit needs whole words, and a fragment left behind is the
 * thing the mark exists to point at.
 */
export function wordStatus(word: string, focused: boolean): WordStatus {
  if (!word) return 'empty'
  if (WORDS.has(word)) return 'known'
  if (focused && suggestions(word).length > 0) return 'partial'
  return 'unknown'
}

export function suggestions(prefix: string): string[] {
  if (!prefix) return []
  const found: string[] = []
  for (const word of wordlist) {
    if (word.startsWith(prefix)) {
      found.push(word)
      if (found.length === SUGGESTION_LIMIT) break
    }
  }
  return found
}

/** True when every slot holds a real word, which is the point the checksum can be checked. */
export function isComplete(slots: readonly string[]): boolean {
  return slots.length === WORD_COUNT && slots.every((word) => WORDS.has(word))
}

export function emptySlots(): string[] {
  return Array.from({ length: WORD_COUNT }, () => '')
}

export function toPhrase(slots: readonly string[]): string {
  return slots.join(' ')
}
