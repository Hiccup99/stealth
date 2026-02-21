/**
 * scroll-trigger.ts
 *
 * Incrementally scrolls a Playwright page to trigger:
 *  - Lazy-loaded images (IntersectionObserver-based loaders)
 *  - Infinite scroll content
 *  - Below-the-fold components that only mount on entry
 *  - Sticky / transform animations that affect layout
 *
 * Strategy:
 *  1. Measure page height
 *  2. Scroll in steps (viewport-sized chunks)
 *  3. After each step, wait for network idle (short timeout) to let lazy requests resolve
 *  4. Repeat until bottom of page
 *  5. Scroll back to top
 */

import type { Page } from 'playwright'

const TAG = '[scroll-trigger]'

export interface ScrollOptions {
  /** Pixel height of each scroll step (default: viewport height) */
  stepPx?: number
  /** ms to wait after each scroll step for lazy loads to fire (default: 400) */
  stepDelayMs?: number
  /** Max number of steps — prevents infinite loops on infinite-scroll pages (default: 20) */
  maxSteps?: number
  /** Whether to scroll back to top after reaching bottom (default: true) */
  returnToTop?: boolean
}

/**
 * Scroll the page to the bottom in steps, triggering lazy-loaded content.
 * Returns the final scroll height after all lazy content loaded.
 */
export async function scrollToRevealContent(
  page: Page,
  log: (msg: string) => void,
  opts: ScrollOptions = {},
): Promise<void> {
  const {
    stepDelayMs = 400,
    maxSteps = 20,
    returnToTop = true,
  } = opts

  let stepPx = opts.stepPx

  try {
    // Get viewport height as default step size
    const viewport = page.viewportSize()
    if (!stepPx) {
      stepPx = viewport?.height ?? 800
    }

    let prevHeight = 0
    let step = 0

    log(`${TAG} starting scroll (stepPx=${stepPx}, maxSteps=${maxSteps})`)

    while (step < maxSteps) {
      // Scroll down by one step
      await page.evaluate((px) => {
        window.scrollBy({ top: px, behavior: 'instant' })
      }, stepPx)

      // Short wait for lazy loaders
      await page.waitForTimeout(stepDelayMs)

      // Also try to resolve any pending network requests from lazy loads
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {
        // networkidle timeout is fine on heavy pages
      })

      // Check current scroll position vs page height
      const { scrollY, scrollHeight } = await page.evaluate(() => ({
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      }))

      step++

      // Detect new content loaded (page height grew)
      if (scrollHeight > prevHeight) {
        log(`${TAG} step ${step}: height grew ${prevHeight} → ${scrollHeight}`)
        prevHeight = scrollHeight
      }

      // Stop if we've reached the bottom
      const viewportH = viewport?.height ?? 800
      if (scrollY + viewportH >= scrollHeight - 100) {
        log(`${TAG} reached bottom at step ${step} (scrollY=${scrollY}, scrollHeight=${scrollHeight})`)
        break
      }
    }

    if (step >= maxSteps) {
      log(`${TAG} reached maxSteps (${maxSteps}) — stopping scroll`)
    }

    // Scroll back to top so element finders see above-fold content first
    if (returnToTop) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await page.waitForTimeout(200)
      log(`${TAG} scrolled back to top`)
    }
  } catch (err) {
    log(`${TAG} warning: scroll failed — ${(err as Error).message}`)
  }
}

/**
 * Scroll to a specific element to ensure it's visible and any lazy
 * content within it has loaded. Returns true if element was found.
 */
export async function scrollToElement(
  page: Page,
  selector: string,
  log: (msg: string) => void,
): Promise<boolean> {
  try {
    const el = page.locator(selector).first()
    const visible = await el.isVisible({ timeout: 1_000 }).catch(() => false)
    if (!visible) return false

    await el.scrollIntoViewIfNeeded({ timeout: 3_000 })
    await page.waitForTimeout(500)
    log(`${TAG} scrolled to: ${selector}`)
    return true
  } catch {
    return false
  }
}
