import { createStore } from 'zustand/vanilla'

export interface HighlightEntry {
  id:       string
  element:  HTMLElement
  label?:   string
  color?:   string
  /** When true, this entry dims alongside others in comparison mode */
  dimmed?:  boolean
}

interface HighlightStore {
  highlights: HighlightEntry[]
  add:        (entry: HighlightEntry) => void
  remove:     (id: string) => void
  update:     (id: string, patch: Partial<Omit<HighlightEntry, 'id'>>) => void
  clear:      () => void
}

export const highlightStore = createStore<HighlightStore>((set) => ({
  highlights: [],

  add: (entry) => set((s) => ({
    // Replace if same id already exists
    highlights: [...s.highlights.filter(h => h.id !== entry.id), entry],
  })),

  remove: (id) => set((s) => ({
    highlights: s.highlights.filter(h => h.id !== id),
  })),

  update: (id, patch) => set((s) => ({
    highlights: s.highlights.map(h => h.id === id ? { ...h, ...patch } : h),
  })),

  clear: () => set({ highlights: [] }),
}))

// ── Imperative helpers ───────────────────────────────────────────────────────

export const addHighlight    = (e: HighlightEntry)                         => highlightStore.getState().add(e)
export const removeHighlight = (id: string)                                 => highlightStore.getState().remove(id)
export const updateHighlight = (id: string, p: Partial<HighlightEntry>)     => highlightStore.getState().update(id, p)
export const clearHighlights = ()                                            => highlightStore.getState().clear()
