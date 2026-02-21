import { h, type VNode } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { highlightStore, type HighlightEntry } from '@/store/highlight-store'

// ── Constants ────────────────────────────────────────────────────────────────

const BRAND_COLOR  = '#5B2D8E'
const BRAND_FILL   = 'rgba(91,45,142,0.08)'
const PAD          = 6    // px padding around each highlight box
const Z_HIGHLIGHTS = 2147483645
const STYLE_ID     = 'wf-highlight-overlay-styles'
const PORTAL_ID    = 'wf-highlight-portal'

// ── CSS keyframes (injected into document.head once) ─────────────────────────

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id    = STYLE_ID
  style.textContent = `
    @keyframes wf-hl-in {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1);    }
    }
    @keyframes wf-hl-out {
      from { opacity: 1; transform: scale(1);    }
      to   { opacity: 0; transform: scale(1.04); }
    }
    @keyframes wf-label-in {
      from { opacity: 0; transform: translateY(5px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
  `
  document.head.appendChild(style)
}

// ── Portal container (singleton on document.body) ────────────────────────────

function getOrCreatePortal(): HTMLDivElement {
  let el = document.getElementById(PORTAL_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = PORTAL_ID
    Object.assign(el.style, {
      position:      'fixed',
      inset:         '0',
      pointerEvents: 'none',
      zIndex:        String(Z_HIGHLIGHTS),
      overflow:      'visible',
    })
    document.body.appendChild(el)
  }
  return el
}

// ── Rect helpers ──────────────────────────────────────────────────────────────

interface Rect { top: number; left: number; width: number; height: number }

function getRect(el: HTMLElement): Rect | null {
  if (!document.contains(el)) return null
  const r = el.getBoundingClientRect()
  // Element is scrolled out of the document / not rendered
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

// ── Single highlight box ──────────────────────────────────────────────────────

interface HighlightBoxProps {
  entry:    HighlightEntry
  entering: boolean
}

function HighlightBox({ entry, entering }: HighlightBoxProps) {
  const rect = getRect(entry.element)
  if (!rect) return null

  const color     = entry.color ?? BRAND_COLOR
  const fillColor = entry.color
    ? `${entry.color}14`   // 8% opacity hex suffix
    : BRAND_FILL

  const boxStyle: h.JSX.CSSProperties = {
    position:        'fixed',
    left:            `${rect.left  - PAD}px`,
    top:             `${rect.top   - PAD}px`,
    width:           `${rect.width + PAD * 2}px`,
    height:          `${rect.height + PAD * 2}px`,
    border:          `2px solid ${color}`,
    background:      fillColor,
    borderRadius:    '6px',
    boxSizing:       'border-box',
    transformOrigin: 'center center',
    opacity:         entry.dimmed ? '0.4' : '1',
    transition:      'opacity 0.2s ease-out',
    animation:       entering ? 'wf-hl-in 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards' : 'none',
    pointerEvents:   'none',
  }

  const labelTop = Math.max(4, rect.top - PAD - 26)
  const labelStyle: h.JSX.CSSProperties = {
    position:      'fixed',
    left:          `${rect.left - PAD}px`,
    top:           `${labelTop}px`,
    background:    color,
    color:         '#fff',
    padding:       '3px 9px',
    borderRadius:  '5px',
    fontSize:      '11px',
    fontFamily:    'Inter, system-ui, sans-serif',
    fontWeight:    '500',
    whiteSpace:    'nowrap',
    lineHeight:    '1.6',
    animation:     entering ? 'wf-label-in 0.2s ease-out forwards' : 'none',
    pointerEvents: 'none',
  }

  return (
    <div data-highlight-id={entry.id}>
      <div style={boxStyle} />
      {entry.label && <div style={labelStyle}>{entry.label}</div>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * HighlightOverlay
 *
 * Renders inside the Preact component tree (shadow DOM) but portals its
 * output into a fixed container on document.body so highlights overlay the
 * real page — not the copilot panel.
 *
 * Subscribes to highlightStore and re-positions on scroll / resize.
 * Use addHighlight() / removeHighlight() from highlight-store.ts to drive it.
 */
export function HighlightOverlay(): VNode | null {
  const [highlights, setHighlights] = useState<HighlightEntry[]>(
    () => highlightStore.getState().highlights,
  )
  // Track which IDs are "entering" (for entrance animation on first render)
  const enteringIds = useRef<Set<string>>(new Set())
  // Tick increments on scroll/resize to trigger rect recalculation
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick(t => t + 1), [])

  // Subscribe to store (vanilla Zustand: listener receives full state + prevState)
  useEffect(() =>
    highlightStore.subscribe((state, prevState) => {
      const next = state.highlights
      const prev = prevState.highlights
      if (next === prev) return
      // Mark newly added IDs for entrance animation
      const prevIds = new Set(prev.map((h: HighlightEntry) => h.id))
      next.forEach((h: HighlightEntry) => { if (!prevIds.has(h.id)) enteringIds.current.add(h.id) })
      setTimeout(() => {
        next.forEach((h: HighlightEntry) => enteringIds.current.delete(h.id))
      }, 250)
      setHighlights(next)
    }),
  [])

  // Recalculate rects on scroll / resize
  useEffect(() => {
    window.addEventListener('scroll', bump, { passive: true })
    window.addEventListener('resize', bump, { passive: true })
    return () => {
      window.removeEventListener('scroll', bump)
      window.removeEventListener('resize', bump)
    }
  }, [bump])

  // One-time setup: inject styles + create portal container
  const portalRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    injectStyles()
    portalRef.current = getOrCreatePortal()
    return () => {
      // Only remove the portal if no highlights remain (avoids flicker on remount)
      if (highlightStore.getState().highlights.length === 0) {
        portalRef.current?.remove()
        portalRef.current = null
      }
    }
  }, [])

  const portal = portalRef.current
  if (!portal || highlights.length === 0) return null

  const boxes = (
    <>
      {highlights.map(entry => (
        <HighlightBox
          key={entry.id}
          entry={entry}
          entering={enteringIds.current.has(entry.id)}
        />
      ))}
    </>
  )

  return createPortal(boxes, portal) as VNode
}
