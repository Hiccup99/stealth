/**
 * ghost-cursor.ts
 *
 * The "guided attention" engine. All DOM elements (cursor, canvas, overlays)
 * are injected directly into document.body — OUTSIDE the shadow DOM — so they
 * overlay real page content without being clipped by our panel.
 *
 * Z-index layout:
 *   page content            : normal
 *   trail canvas            : Z_BASE - 1  (2147483645)
 *   cursor dot + overlays   : Z_BASE      (2147483646)
 *   shadow host (panel)     : Z_BASE + 1  (2147483647)
 */

// ── Constants ────────────────────────────────────────────────────────────────

const BRAND_COLOR  = '#5B2D8E'
const Z_BASE       = 2147483646
const TAG          = '[Wakefit Copilot · ghost-cursor]'

// ── Types ────────────────────────────────────────────────────────────────────

interface Point { x: number; y: number }

export interface MoveOptions {
  speed?:           'fast' | 'normal' | 'slow'
  highlight?:       boolean
  highlightColor?:  string
  label?:           string
}

export interface WalkOptions {
  speed?:           MoveOptions['speed']
  highlightColor?:  string
  pauseMs?:         number
  onStep?:          (current: number, total: number) => void
}

// ── Module state (singleton) ─────────────────────────────────────────────────

let cursorEl:    HTMLDivElement    | null = null
let canvasEl:    HTMLCanvasElement | null = null
let overlayEl:   HTMLDivElement    | null = null
let labelEl:     HTMLDivElement    | null = null
let stepEl:      HTMLDivElement    | null = null
let trailRafId:  number            | null = null
let overlayTimer: ReturnType<typeof setTimeout> | null = null
let styleInjected = false

// Off-screen so first moveTo animates from outside the viewport
let currentPos: Point = { x: -120, y: -120 }

// ── CSS injection ─────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (styleInjected) return
  styleInjected = true
  const style = document.createElement('style')
  style.id    = 'wf-ghost-cursor-styles'
  style.textContent = `
    @keyframes wf-pulse {
      0%   { box-shadow: 0 0 0 0   rgba(91,45,142,0.7); }
      70%  { box-shadow: 0 0 0 10px rgba(91,45,142,0);   }
      100% { box-shadow: 0 0 0 0   rgba(91,45,142,0);   }
    }
    @keyframes wf-highlight-in {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1);    }
    }
    @keyframes wf-highlight-out {
      from { opacity: 1; transform: scale(1);    }
      to   { opacity: 0; transform: scale(1.05); }
    }
    @keyframes wf-label-in {
      from { opacity: 0; transform: translateY(5px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
  `
  document.head.appendChild(style)
}

// ── Element factories ─────────────────────────────────────────────────────────

function ensureCursor(): HTMLDivElement {
  if (cursorEl) return cursorEl
  injectStyles()

  cursorEl = document.createElement('div')
  cursorEl.id = 'wf-ghost-cursor'
  // Use transform-only for 60fps (no layout thrashing)
  cursorEl.style.cssText = `position:fixed;width:12px;height:12px;border-radius:50%;background:${BRAND_COLOR};animation:wf-pulse 1.4s ease-out infinite;pointer-events:none;z-index:${Z_BASE};transform:translate(-50%,-50%) translate3d(${currentPos.x}px,${currentPos.y}px,0);will-change:transform`

  document.body.appendChild(cursorEl)
  startTrailLoop()
  console.debug(`${TAG} cursor element created`)
  return cursorEl
}

function ensureCanvas(): HTMLCanvasElement {
  if (canvasEl) return canvasEl

  canvasEl = document.createElement('canvas')
  canvasEl.id = 'wf-ghost-cursor-trail'
  Object.assign(canvasEl.style, {
    position:      'fixed',
    top:           '0',
    left:          '0',
    width:         '100%',
    height:        '100%',
    pointerEvents: 'none',
    zIndex:        String(Z_BASE - 1),
  })
  canvasEl.width  = window.innerWidth
  canvasEl.height = window.innerHeight

  window.addEventListener('resize', () => {
    if (!canvasEl) return
    canvasEl.width  = window.innerWidth
    canvasEl.height = window.innerHeight
  }, { passive: true })

  document.body.appendChild(canvasEl)
  return canvasEl
}

function ensureOverlay(): HTMLDivElement {
  if (overlayEl) return overlayEl

  overlayEl = document.createElement('div')
  overlayEl.id = 'wf-highlight-overlay'
  Object.assign(overlayEl.style, {
    position:        'fixed',
    pointerEvents:   'none',
    zIndex:          String(Z_BASE),
    boxSizing:       'border-box',
    borderRadius:    '6px',
    transformOrigin: 'center center',
    display:         'none',
  })
  document.body.appendChild(overlayEl)
  return overlayEl
}

function ensureLabelEl(): HTMLDivElement {
  if (labelEl) return labelEl

  labelEl = document.createElement('div')
  labelEl.id = 'wf-highlight-label'
  Object.assign(labelEl.style, {
    position:      'fixed',
    pointerEvents: 'none',
    zIndex:        String(Z_BASE + 1),
    background:    BRAND_COLOR,
    color:         '#fff',
    padding:       '4px 10px',
    borderRadius:  '6px',
    fontSize:      '12px',
    fontFamily:    'Inter, system-ui, sans-serif',
    fontWeight:    '500',
    whiteSpace:    'nowrap',
    display:       'none',
  })
  document.body.appendChild(labelEl)
  return labelEl
}

function ensureStepEl(): HTMLDivElement {
  if (stepEl) return stepEl

  stepEl = document.createElement('div')
  stepEl.id = 'wf-step-counter'
  Object.assign(stepEl.style, {
    position:       'fixed',
    bottom:         '80px',
    left:           '50%',
    transform:      'translateX(-50%)',
    pointerEvents:  'none',
    zIndex:         String(Z_BASE + 1),
    background:     'rgba(0,0,0,0.72)',
    color:          '#fff',
    padding:        '6px 18px',
    borderRadius:   '20px',
    fontSize:       '13px',
    fontFamily:     'Inter, system-ui, sans-serif',
    fontWeight:     '500',
    backdropFilter: 'blur(6px)',
    display:        'none',
  })
  document.body.appendChild(stepEl)
  return stepEl
}

// ── Comet trail ───────────────────────────────────────────────────────────────
//
// A persistent RAF loop reads `currentPos` (updated by moveTo) and draws a
// fading radial gradient dot on the canvas. The fade-fill trick creates the
// "comet tail" — each new frame dims the previous dot, producing a trail.

const TRAIL_MAX = 24
const _trail: Point[] = []

function startTrailLoop(): void {
  const canvas = ensureCanvas()
  const ctx    = canvas.getContext('2d')
  if (!ctx || trailRafId !== null) return

  function frame(): void {
    // Record current position into trail ring buffer
    if (currentPos.x >= 0 && currentPos.y >= 0) {
      _trail.push({ ...currentPos })
      if (_trail.length > TRAIL_MAX) _trail.shift()
    }

    // Clear to fully transparent each frame — never accumulate white
    ctx!.clearRect(0, 0, canvas.width, canvas.height)

    // Draw trail points with decreasing opacity (oldest = most faded)
    for (let i = 0; i < _trail.length; i++) {
      const { x, y } = _trail[i]!
      const progress = (i + 1) / _trail.length          // 0→1, oldest→newest
      const opacity  = progress * 0.7
      const radius   = 3 + progress * 5
      const grad     = ctx!.createRadialGradient(x, y, 0, x, y, radius)
      grad.addColorStop(0, `rgba(91,45,142,${opacity.toFixed(2)})`)
      grad.addColorStop(1, 'rgba(91,45,142,0)')
      ctx!.beginPath()
      ctx!.arc(x, y, radius, 0, Math.PI * 2)
      ctx!.fillStyle = grad
      ctx!.fill()
    }

    trailRafId = requestAnimationFrame(frame)
  }

  trailRafId = requestAnimationFrame(frame)
}

function clearTrailCanvas(): void {
  if (canvasEl) {
    canvasEl.getContext('2d')?.clearRect(0, 0, canvasEl.width, canvasEl.height)
  }
}

// ── Bezier math ───────────────────────────────────────────────────────────────

function cubicBezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const mt = 1 - t
  return {
    x: mt**3 * p0.x + 3*mt**2*t * p1.x + 3*mt*t**2 * p2.x + t**3 * p3.x,
    y: mt**3 * p0.y + 3*mt**2*t * p1.y + 3*mt*t**2 * p2.y + t**3 * p3.y,
  }
}

/**
 * Two Bezier control points that produce a natural mouse-like arc.
 * The arc bows perpendicular to the direct path (as a human wrist naturally curves).
 */
function calcControlPoints(from: Point, to: Point): [Point, Point] {
  const dx   = to.x - from.x
  const dy   = to.y - from.y
  const dist = Math.hypot(dx, dy) || 1
  const bow  = Math.min(dist * 0.22, 100)  // perpendicular bow magnitude

  // Perpendicular unit vector (rotated 90°), scaled by bow
  const px = (-dy / dist) * bow
  const py = ( dx / dist) * bow

  return [
    { x: from.x + dx * 0.25 + px, y: from.y + dy * 0.25 + py },
    { x: from.x + dx * 0.75 + px, y: from.y + dy * 0.75 + py },
  ]
}

/** Smooth-step easing: s-curve that starts and ends gently */
function smoothStep(t: number): number {
  return t * t * (3 - 2 * t)
}

// ── Scroll helper ─────────────────────────────────────────────────────────────

function isInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return (
    r.top    >= 0 &&
    r.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    r.left   >= 0 &&
    r.right  <= (window.innerWidth  || document.documentElement.clientWidth)
  )
}

async function scrollToIfNeeded(el: HTMLElement): Promise<void> {
  if (isInViewport(el)) return

  return new Promise(resolve => {
    // Use IntersectionObserver instead of scroll listener (more performant)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect()
          resolve()
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    )
    observer.observe(el)
    
    // Safety valve: resolve after 1.2s regardless
    setTimeout(() => {
      observer.disconnect()
      resolve()
    }, 1200)
    
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

// ── Duration ──────────────────────────────────────────────────────────────────

const SPEED_BASE_MS = { fast: 500, normal: 750, slow: 1000 } as const

function calcDuration(from: Point, to: Point, speed: MoveOptions['speed'] = 'normal'): number {
  const dist   = Math.hypot(to.x - from.x, to.y - from.y)
  const base   = SPEED_BASE_MS[speed]
  // Scale duration with distance, clamped to [60%, 140%] of base
  const factor = 0.6 + Math.min(dist / 1200, 0.8)
  return Math.round(Math.max(base * 0.6, Math.min(base * 1.4, base * factor)))
}

// ── Public: moveTo ────────────────────────────────────────────────────────────

/**
 * Move the ghost cursor to the center of `element`.
 * Scrolls the element into view first if needed, then animates along a
 * cubic Bezier arc path.
 */
export async function moveTo(element: HTMLElement, options: MoveOptions = {}): Promise<void> {
  const cursor = ensureCursor()
  const { speed = 'normal', highlight: doHighlight = false, highlightColor, label } = options

  // Step 1: ensure element is visible
  await scrollToIfNeeded(element)

  const rect = element.getBoundingClientRect()
  const end: Point = {
    x: rect.left + rect.width  / 2,
    y: rect.top  + rect.height / 2,
  }

  const start = { ...currentPos }
  const durationMs = calcDuration(start, end, speed)
  const [cp1, cp2] = calcControlPoints(start, end)

  console.debug(`${TAG} moveTo — start:(${Math.round(start.x)},${Math.round(start.y)}) end:(${Math.round(end.x)},${Math.round(end.y)}) duration:${durationMs}ms`)

  // Step 2: animate along Bezier curve
  await new Promise<void>(resolve => {
    const t0 = performance.now()

    function tick(now: number): void {
      const rawT = Math.min((now - t0) / durationMs, 1)
      const t    = smoothStep(rawT)
      const pos  = cubicBezierPoint(t, start, cp1, cp2, end)

      currentPos = pos
      // Transform-only for 60fps (no layout thrashing)
      cursor.style.transform = `translate(-50%,-50%) translate3d(${pos.x}px,${pos.y}px,0)`

      if (rawT < 1) {
        requestAnimationFrame(tick)
      } else {
        currentPos = end
        cursor.style.transform = `translate(-50%,-50%) translate3d(${end.x}px,${end.y}px,0)`
        resolve()
      }
    }

    requestAnimationFrame(tick)
  })

  // Step 3: optional highlight
  if (doHighlight) {
    await highlight(element, { color: highlightColor, label })
  }
}

// ── Public: highlight ─────────────────────────────────────────────────────────

/**
 * Draw a highlight box around `element` with an animated entrance.
 * Auto-dismisses after `duration` ms (default 5 s).
 */
export async function highlight(
  element: HTMLElement,
  options: { color?: string; label?: string; duration?: number } = {},
): Promise<void> {
  const { color = BRAND_COLOR, label: text, duration = 5000 } = options

  if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null }

  const overlay = ensureOverlay()
  const rect    = element.getBoundingClientRect()
  const PAD     = 6

  // Hex → rgba at 8% opacity for fill
  const fillAlpha = color === BRAND_COLOR ? 'rgba(91,45,142,0.08)' : `${color}14`

  Object.assign(overlay.style, {
    left:      `${rect.left   - PAD}px`,
    top:       `${rect.top    - PAD}px`,
    width:     `${rect.width  + PAD * 2}px`,
    height:    `${rect.height + PAD * 2}px`,
    border:    `2px dashed ${color}`,
    background: fillAlpha,
    display:   'block',
    animation: 'wf-highlight-in 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards',
  })

  // Label floats above the overlay box
  if (text) {
    const lbl = ensureLabelEl()
    lbl.textContent = text
    Object.assign(lbl.style, {
      left:      `${rect.left - PAD}px`,
      top:       `${Math.max(4, rect.top - PAD - 28)}px`,
      display:   'block',
      animation: 'wf-label-in 0.2s ease-out forwards',
    })
  }

  overlayTimer = setTimeout(dismissHighlight, duration)
}

function dismissHighlight(): void {
  overlayTimer = null
  if (!overlayEl) return
  overlayEl.style.animation = 'wf-highlight-out 0.25s ease-in forwards'
  setTimeout(() => {
    if (overlayEl) overlayEl.style.display = 'none'
    if (labelEl)   labelEl.style.display   = 'none'
  }, 260)
}

// ── Public: walkThrough ───────────────────────────────────────────────────────

/**
 * Guide the user through a sequence of elements.
 * Shows a step counter ("Step 2 of 5"), moves the cursor to each element,
 * highlights it, then pauses before proceeding to the next.
 */
export async function walkThrough(
  elements: HTMLElement[],
  options: WalkOptions = {},
): Promise<void> {
  const {
    speed          = 'normal',
    highlightColor,
    pauseMs        = 1500,
    onStep,
  } = options

  const total   = elements.length
  const counter = ensureStepEl()
  counter.style.display = 'block'

  for (let i = 0; i < total; i++) {
    counter.textContent = `Step ${i + 1} of ${total}`
    onStep?.(i + 1, total)

    console.debug(`${TAG} walkThrough step ${i + 1}/${total}`)
    await moveTo(elements[i], { speed, highlight: true, highlightColor })

    if (i < total - 1) {
      await pause(pauseMs)
    }
  }

  // Fade step counter after completion
  await pause(1200)
  counter.style.display = 'none'
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Returns the element's bounding box relative to the viewport. */
export function getBoundingBox(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect()
}

/** True if any part of the element is currently inside the viewport. */
export function isElementVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return (
    r.bottom > 0 &&
    r.right  > 0 &&
    r.top    < (window.innerHeight || document.documentElement.clientHeight) &&
    r.left   < (window.innerWidth  || document.documentElement.clientWidth)
  )
}

function pause(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ── Debug / status ────────────────────────────────────────────────────────────

/**
 * Check if the ghost cursor is initialized and attached to the DOM.
 * Useful for debugging — returns status object with element references.
 */
export function getStatus(): {
  initialized: boolean
  cursor:      HTMLDivElement | null
  canvas:      HTMLCanvasElement | null
  overlay:     HTMLDivElement | null
  position:    Point
} {
  return {
    initialized: cursorEl !== null && document.body.contains(cursorEl),
    cursor:      cursorEl,
    canvas:      canvasEl,
    overlay:     overlayEl,
    position:    { ...currentPos },
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/** Remove all injected DOM nodes and stop the trail loop. */
export function destroy(): void {
  if (trailRafId !== null) { cancelAnimationFrame(trailRafId); trailRafId = null }
  if (overlayTimer)         { clearTimeout(overlayTimer);       overlayTimer = null }

  cursorEl?.remove();  cursorEl  = null
  canvasEl?.remove();  canvasEl  = null
  overlayEl?.remove(); overlayEl = null
  labelEl?.remove();   labelEl   = null
  stepEl?.remove();    stepEl    = null

  document.getElementById('wf-ghost-cursor-styles')?.remove()
  styleInjected = false
  currentPos = { x: -120, y: -120 }

  clearTrailCanvas()
  console.debug(`${TAG} destroyed`)
}
