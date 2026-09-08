/*
 * The recovery phrase field: twelve numbered slots rather than one text box.
 *
 * Slots make a wrong word findable: one box tells you only that the phrase is
 * wrong, and the words people get wrong are the ones that look right, so each
 * is marked against the BIP-39 list as it is typed. The twelve behave as one
 * field, with space advancing, a pasted phrase filling all of them wherever it
 * lands, and backspace stepping back out of an empty slot.
 */

import { useRef, useState } from 'react'
import {
  fillFrom,
  normalizeWord,
  splitPhrase,
  suggestions as suggestionsFor,
  WORD_COUNT,
  wordStatus,
} from './phrase'

type Props = {
  slots: string[]
  onChange: (slots: string[]) => void
  /** A generated phrase is shown in the same grid, so both halves of sign-in read alike. */
  readOnly?: boolean
  disabled?: boolean
}

export function PhraseGrid({ slots, onChange, readOnly, disabled }: Props) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const [focused, setFocused] = useState<number | null>(null)
  const [highlight, setHighlight] = useState(0)

  const focusedWord = focused === null ? '' : (slots[focused] ?? '')
  const matches = readOnly ? [] : suggestionsFor(focusedWord)
  // Nothing to offer when the slot already holds the only word it could become.
  const options = matches.length === 1 && matches[0] === focusedWord ? [] : matches
  // Each keystroke narrows the list, so the row that was highlighted can fall
  // off the end of it while the arrow keys are still pointing at that row.
  const active = options.length === 0 ? -1 : Math.min(highlight, options.length - 1)

  function focusSlot(index: number) {
    const input = inputs.current[index]
    input?.focus()
    input?.select()
  }

  function write(index: number, word: string) {
    if (readOnly) return
    const next = [...slots]
    next[index] = word
    onChange(next)
  }

  function accept(index: number, word: string) {
    write(index, word)
    if (index + 1 < WORD_COUNT) focusSlot(index + 1)
  }

  function handlePaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    // A read-only input still raises this event; it just does not insert.
    if (readOnly) return
    const words = splitPhrase(event.clipboardData.getData('text'))
    if (words.length < 2) return

    event.preventDefault()
    // A whole phrase fills the grid from the top wherever it was dropped, since
    // pasting one into slot seven is a misfire rather than a request.
    const start = words.length >= WORD_COUNT ? 0 : index
    onChange(fillFrom(slots, start, words))
    focusSlot(Math.min(start + words.length, WORD_COUNT - 1))
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    const word = slots[index] ?? ''
    const pick = options[active]

    if (options.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : options.length - 1
      setHighlight((active + step) % options.length)
      return
    }

    if (event.key === ' ' || event.key === 'Tab' || event.key === 'Enter') {
      if (pick && !(event.key === 'Enter' && pick === word)) {
        // Tab on the last slot keeps its native move: the word is written and
        // focus goes on to the submit button instead of staying trapped here.
        // Enter with the word already complete falls through the same way, to
        // the form submit below, rather than re-accepting it forever.
        if (!(event.key === 'Tab' && index + 1 === WORD_COUNT)) event.preventDefault()
        accept(index, pick)
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        if (index + 1 < WORD_COUNT) focusSlot(index + 1)
      }
      // Enter with nothing to complete submits the surrounding form.
      return
    }

    const caret = event.currentTarget.selectionStart ?? 0
    if (event.key === 'Backspace' && !word && index > 0) {
      event.preventDefault()
      focusSlot(index - 1)
    } else if (event.key === 'ArrowLeft' && caret === 0 && index > 0) {
      event.preventDefault()
      focusSlot(index - 1)
    } else if (event.key === 'ArrowRight' && caret === word.length && index + 1 < WORD_COUNT) {
      event.preventDefault()
      focusSlot(index + 1)
    }
  }

  return (
    // Three to a row: the shape a phrase is written down in.
    <ol className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
      {slots.map((word, index) => {
        const position = index + 1
        const unknown = wordStatus(word, focused === index) === 'unknown'
        const open = focused === index && options.length > 0
        const listId = `phrase-options-${position}`
        return (
          // A slot is identified by its position; the words in it come and go.
          // Relative, because the suggestion list hangs off it.
          <li key={index} className="relative">
            <div
              className={`flex items-center gap-1.5 rounded-md border bg-card px-[7px] py-1 focus-within:border-accent focus-within:shadow-[0_0_0_2px_rgb(10_132_255/30%)] ${
                // Red only once the word cannot become a real one, never mid-keystroke.
                unknown ? 'border-red' : 'border-divider'
              }`}
            >
              <span className="w-[11px] shrink-0 text-right text-[9px] text-secondary tabular-nums select-none">
                {position}
              </span>
              <input
                className={`w-full min-w-0 flex-auto border-none bg-transparent p-0 font-mono text-[11px] outline-none ${
                  unknown ? 'text-red' : 'text-label'
                }`}
                ref={(element) => {
                  inputs.current[index] = element
                }}
                value={word}
                readOnly={readOnly}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                // The combobox pattern is what tells a screen reader that
                // completions appeared and which one Enter will accept; the
                // arrows move a highlight the buttons never focus.
                role="combobox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open ? `${listId}-${active}` : undefined}
                aria-autocomplete="list"
                aria-label={`Word ${position}`}
                aria-invalid={unknown || undefined}
                onChange={(event) => write(index, normalizeWord(event.target.value))}
                onFocus={() => {
                  setFocused(index)
                  setHighlight(0)
                }}
                onBlur={() => setFocused((current) => (current === index ? null : current))}
                onPaste={(event) => handlePaste(index, event)}
                onKeyDown={(event) => handleKeyDown(index, event)}
              />
            </div>

            {open ? (
              <ul
                id={listId}
                role="listbox"
                className="absolute top-[calc(100%+3px)] left-0 z-2 m-0 min-w-full list-none rounded-md border border-divider bg-menu p-[3px] shadow-[0_6px_16px_rgb(0_0_0/28%)] backdrop-blur-[24px]"
              >
                {options.map((option, rank) => (
                  <li
                    key={option}
                    id={`${listId}-${rank}`}
                    role="option"
                    aria-selected={rank === active}
                  >
                    <button
                      type="button"
                      // Out of the tab order: these are the next focusable
                      // elements after the input, so Tab from the last slot
                      // would land here instead of leaving the grid. The
                      // keyboard path is the arrows and Enter.
                      tabIndex={-1}
                      className={`block w-full cursor-default rounded border-none bg-transparent px-1.5 py-[3px] text-left font-mono text-[11px] ${
                        rank === active ? 'bg-accent text-white' : 'text-label'
                      }`}
                      // Losing focus before the click lands would close this list first.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => accept(index, option)}
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
