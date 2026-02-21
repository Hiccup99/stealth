/**
 * user-requirements-store.ts
 *
 * Persists customer requirements across page navigations during the same
 * browser session. Backed by chrome.storage.session so it survives SPA
 * navigation but clears when the browser is closed.
 *
 * The store is synchronised on first read. Writers call `save()` after
 * mutation so chrome.storage.session stays in sync.
 */

import { createStore } from 'zustand/vanilla'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserRequirements {
  budget?:        { min?: number; max?: number }
  sleepPosition?: 'side' | 'back' | 'stomach' | 'combination'
  mattressType?:  'foam' | 'spring' | 'latex' | 'hybrid'
  productCategory?: 'mattress' | 'bed' | 'pillow' | 'bedsheet' | 'sofa' | 'other'
  size?:          string          // 'king', 'queen', 'single', 'double'
  concerns?:      string[]        // ['back pain', 'hot sleeper', 'partner disturbance', …]
  rawNotes?:      string          // free-form summary from conversation
  /** ISO timestamp of last update */
  updatedAt?:     string
}

interface RequirementsStore {
  requirements: UserRequirements
  /** True once we've attempted a load from chrome.storage.session */
  loaded: boolean

  setRequirement: <K extends keyof UserRequirements>(key: K, value: UserRequirements[K]) => void
  mergeRequirements: (partial: Partial<UserRequirements>) => void
  clearRequirements: () => void
  /** Load from chrome.storage.session — call once on content script init */
  load: () => Promise<void>
  /** Persist current state to chrome.storage.session */
  save: () => Promise<void>
}

const STORAGE_KEY = 'wakefit_user_requirements'

// ── Store ─────────────────────────────────────────────────────────────────────

export const requirementsStore = createStore<RequirementsStore>((set, get) => ({
  requirements: {},
  loaded:       false,

  setRequirement(key, value) {
    set(s => ({
      requirements: { ...s.requirements, [key]: value, updatedAt: new Date().toISOString() },
    }))
    get().save()
  },

  mergeRequirements(partial) {
    set(s => ({
      requirements: { ...s.requirements, ...partial, updatedAt: new Date().toISOString() },
    }))
    get().save()
  },

  clearRequirements() {
    set({ requirements: {} })
    get().save()
  },

  async load() {
    if (get().loaded) return
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const result = await chrome.storage.session.get(STORAGE_KEY)
        const stored = result[STORAGE_KEY] as UserRequirements | undefined
        if (stored && typeof stored === 'object') {
          set({ requirements: stored, loaded: true })
        } else {
          set({ loaded: true })
        }
      } else {
        // Fallback: sessionStorage (for non-extension dev environments)
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (raw) {
          try { set({ requirements: JSON.parse(raw), loaded: true }) } catch { set({ loaded: true }) }
        } else {
          set({ loaded: true })
        }
      }
    } catch (err) {
      console.warn('[RequirementsStore] load failed:', err)
      set({ loaded: true })
    }
  },

  async save() {
    const { requirements } = get()
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        await chrome.storage.session.set({ [STORAGE_KEY]: requirements })
      } else {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(requirements))
      }
    } catch (err) {
      console.warn('[RequirementsStore] save failed:', err)
    }
  },
}))

// ── Convenience accessors ─────────────────────────────────────────────────────

export function getRequirements(): UserRequirements {
  return requirementsStore.getState().requirements
}

/**
 * Formats the stored requirements as a compact string to inject into the
 * LLM system prompt / context.  Returns empty string if nothing is known.
 */
export function formatRequirementsForPrompt(): string {
  const r = getRequirements()
  const lines: string[] = []

  if (r.productCategory) lines.push(`Looking for: ${r.productCategory}`)
  if (r.size)            lines.push(`Size: ${r.size}`)
  if (r.budget) {
    const { min, max } = r.budget
    if (min && max)      lines.push(`Budget: ₹${min.toLocaleString('en-IN')} – ₹${max.toLocaleString('en-IN')}`)
    else if (max)        lines.push(`Budget: up to ₹${max.toLocaleString('en-IN')}`)
    else if (min)        lines.push(`Budget: from ₹${min.toLocaleString('en-IN')}`)
  }
  if (r.sleepPosition)  lines.push(`Sleep position: ${r.sleepPosition}`)
  if (r.mattressType)   lines.push(`Mattress type preference: ${r.mattressType}`)
  if (r.concerns?.length) lines.push(`Concerns: ${r.concerns.join(', ')}`)
  if (r.rawNotes)       lines.push(`Notes: ${r.rawNotes}`)

  return lines.length > 0 ? `CUSTOMER PROFILE:\n${lines.join('\n')}` : ''
}
