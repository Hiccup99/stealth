import { createStore } from 'zustand/vanilla'
import type { ProductPageData } from '../content/modules/page-scanner'

interface PageStore {
  data:            ProductPageData | null
  scanning:        boolean
  /**
   * Product name from the previous page — set by content/index.ts just before
   * clear() on SPA navigation, so the new CopilotPanel can show:
   * "I see you've moved on to {newProduct}…"
   */
  navigatedFrom:   string | null

  setData:           (data: ProductPageData) => void
  setScanning:       (scanning: boolean) => void
  setNavigatedFrom:  (name: string | null) => void
  clear:             () => void
}

export const pageStore = createStore<PageStore>((set) => ({
  data:          null,
  scanning:      false,
  navigatedFrom: null,

  setData:          (data)          => set({ data, scanning: false }),
  setScanning:      (scanning)      => set({ scanning }),
  setNavigatedFrom: (navigatedFrom) => set({ navigatedFrom }),
  // clear() resets data/scanning but NOT navigatedFrom — that is set explicitly
  // right after clear() in onNavigate(), so the next component can read it.
  clear: () => set({ data: null, scanning: false, navigatedFrom: null }),
}))
