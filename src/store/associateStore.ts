import { createStore } from "zustand/vanilla";

export type AssociateState =
  | "idle"
  | "listening"
  | "thinking"
  | "navigating"
  | "highlighting";

interface AssociateStore {
  isActive: boolean;
  state: AssociateState;
  currentQuery: string;
  cursorPosition: { x: number; y: number };

  activate: () => void;
  deactivate: () => void;
  setState: (state: AssociateState) => void;
  setQuery: (query: string) => void;
  setCursorPosition: (x: number, y: number) => void;
}

export const associateStore = createStore<AssociateStore>((set) => ({
  isActive: false,
  state: "idle",
  currentQuery: "",
  cursorPosition: { x: 0, y: 0 },

  activate: () => set({ isActive: true, state: "listening" }),
  deactivate: () => set({ isActive: false, state: "idle", currentQuery: "" }),
  setState: (state) => set({ state }),
  setQuery: (currentQuery) => set({ currentQuery }),
  setCursorPosition: (x, y) => set({ cursorPosition: { x, y } }),
}));

// React-hook wrapper (uses preact/compat in the extension, plain zustand/react in tests)
export function useAssociateStore<T>(selector: (s: AssociateStore) => T): T {
  return selector(associateStore.getState());
}
