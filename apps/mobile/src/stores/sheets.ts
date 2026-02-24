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

export async function closeSheet(): Promise<void> {
  setState(() => {
    return { openName: '' }
  })
  await new Promise((resolve) => setTimeout(resolve, 220))
}

export function useSheetOpen(name: string): boolean {
  return useSheetsStore((s) => s.openName === name)
}
