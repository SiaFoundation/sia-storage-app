import { create } from 'zustand'

type SheetsState = {
  openName: string
  open: (name: string) => void
  close: () => void
  toggle: (name: string) => void
  isOpen: (name: string) => boolean
}

export const useSheetsStore = create<SheetsState>((set, get) => ({
  openName: '',
  open: (name) =>
    set(() => {
      return { openName: name }
    }),
  close: () =>
    set(() => {
      return { openName: '' }
    }),
  toggle: (name) =>
    set((state) => {
      const next = state.openName
      if (next === name) return { openName: '' }
      else return { openName: name }
    }),
  isOpen: (name) => get().openName === name,
}))

export function useSheetOpen(name: string): boolean {
  return useSheetsStore((s) => s.openName === name)
}

export function openSheet(name: string): void {
  useSheetsStore.getState().open(name)
}

export async function closeSheet(): Promise<void> {
  useSheetsStore.getState().close()
  await new Promise((resolve) => setTimeout(resolve, 220))
}
