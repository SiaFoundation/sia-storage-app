import { create } from 'zustand'

type SheetsState = {
  openName: string
}

export const useSheetsStore = create<SheetsState>(() => ({
  openName: '',
}))

const { setState } = useSheetsStore

export function openSheet(name: string): void {
  setState(() => {
    return { openName: name }
  })
}

export async function closeSheet(name?: string): Promise<void> {
  setState((state) => {
    // Only close if this sheet is actually open, so callers don't
    // accidentally dismiss a different sheet that opened in the meantime.
    if (name && state.openName !== name) return state
    return { openName: '' }
  })
  await new Promise((resolve) => setTimeout(resolve, 220))
}

export function useSheetOpen(name: string): boolean {
  return useSheetsStore((s) => s.openName === name)
}
