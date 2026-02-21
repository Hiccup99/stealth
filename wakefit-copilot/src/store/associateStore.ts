import { createStore } from 'zustand/vanilla'

export type AssociatePhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'navigating'
  | 'highlighting'

interface AssociateState {
  isActive: boolean
  phase: AssociatePhase
  currentQuery: string
  cursorPosition: { x: number; y: number }
}

interface AssociateActions {
  activate: () => void
  deactivate: () => void
  setPhase: (phase: AssociatePhase) => void
  setQuery: (query: string) => void
  setCursorPosition: (x: number, y: number) => void
}

export const associateStore = createStore<AssociateState & AssociateActions>((set) => ({
  isActive: false,
  phase: 'idle',
  currentQuery: '',
  cursorPosition: { x: 0, y: 0 },

  activate: () => set({ isActive: true, phase: 'listening' }),
  deactivate: () => set({ isActive: false, phase: 'idle', currentQuery: '' }),
  setPhase: (phase) => set({ phase }),
  setQuery: (currentQuery) => set({ currentQuery }),
  setCursorPosition: (x, y) => set({ cursorPosition: { x, y } }),
}))
