/**
 * content-verifier.ts
 *
 * After a CSS selector matches elements on a page, verifies that those
 * elements actually contain meaningful content.
 *
 * Verification modes (from ecommerce-taxonomy.ts):
 *   'text'   → trimmed text length ≥ MIN_TEXT_LEN characters
 *   'price'  → text contains digits and currency symbols (looks like a price)
 *   'image'  → element or descendant <img> has a non-empty src
 *   'exists' → just needs to be in DOM and visible
 *   'count'  → at least MIN_COUNT matching elements present
 */

import type { Page } from 'playwright'
import type { VerifyMode } from './ecommerce-taxonomy'

const MIN_TEXT_LEN = 3
const MIN_COUNT    = 2

// Matches: ₹1,999 | $29.99 | £49 | 1,999.00 | 49.99
const PRICE_RE = /[\$€£₹¥₩]?\s*\d[\d,.\s]*\d|\d[\d,.\s]*[\$€£₹¥₩]/

export interface VerifyResult {
  valid: boolean
  /** The extracted sample value (for exampleValue in SelectorEntry) */
  exampleValue?: string
}

// ── Per-page verification ─────────────────────────────────────────────────────

/**
 * Verify that `selector` matches meaningful content on `page`.
 * Returns { valid, exampleValue }.
 */
export async function verifySelector(
  page: Page,
  selector: string,
  mode: VerifyMode,
): Promise<VerifyResult> {
  try {
    switch (mode) {
      case 'exists':
        return verifyExists(page, selector)

      case 'text':
        return verifyText(page, selector)

      case 'price':
        return verifyPrice(page, selector)

      case 'image':
        return verifyImage(page, selector)

      case 'count':
        return verifyCount(page, selector)

      default:
        return { valid: false }
    }
  } catch {
    return { valid: false }
  }
}

// ── Mode implementations ──────────────────────────────────────────────────────

async function verifyExists(page: Page, selector: string): Promise<VerifyResult> {
  const count = await page.locator(selector).count()
  return { valid: count > 0 }
}

async function verifyText(page: Page, selector: string): Promise<VerifyResult> {
  const result = await page.evaluate(
    ({ sel, minLen }) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const text = (el.textContent ?? '').trim()
      return text.length >= minLen ? text.slice(0, 100) : null
    },
    { sel: selector, minLen: MIN_TEXT_LEN },
  )
  if (!result) return { valid: false }
  return { valid: true, exampleValue: result }
}

async function verifyPrice(page: Page, selector: string): Promise<VerifyResult> {
  const result = await page.evaluate(
    (sel) => {
      const els = document.querySelectorAll(sel)
      for (const el of els) {
        const text = (el.textContent ?? '').trim()
        if (text.length > 0) return text.slice(0, 50)
      }
      return null
    },
    selector,
  )
  if (!result) return { valid: false }
  if (!PRICE_RE.test(result)) return { valid: false }
  return { valid: true, exampleValue: result }
}

async function verifyImage(page: Page, selector: string): Promise<VerifyResult> {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null

    // The element itself might be an <img>
    if (el.tagName === 'IMG') {
      const src = (el as HTMLImageElement).src
      return src && !src.startsWith('data:image/gif') && src.length > 10 ? src : null
    }

    // Or contains an <img>
    const img = el.querySelector('img')
    if (img) {
      const src = img.src
      return src && !src.startsWith('data:image/gif') && src.length > 10 ? src : null
    }

    // Or a background-image
    const style = window.getComputedStyle(el).backgroundImage
    return style && style !== 'none' ? style.slice(0, 80) : null
  }, selector)

  return result ? { valid: true, exampleValue: result } : { valid: false }
}

async function verifyCount(page: Page, selector: string): Promise<VerifyResult> {
  const count = await page.locator(selector).count()
  if (count < MIN_COUNT) return { valid: false }

  // Get example text from first item
  const example = await page.evaluate(
    ({ sel }) => {
      const el = document.querySelector(sel)
      return (el?.textContent ?? '').trim().slice(0, 80) || null
    },
    { sel: selector },
  )

  return { valid: true, exampleValue: example ?? `${count} items` }
}

// ── Batch verification ────────────────────────────────────────────────────────

export interface BatchVerifyResult {
  selector: string
  mode: VerifyMode
  valid: boolean
  exampleValue?: string
}

/**
 * Verify a list of (selector, mode) pairs against a page.
 * Returns results in same order.
 */
export async function batchVerify(
  page: Page,
  items: Array<{ selector: string; mode: VerifyMode }>,
): Promise<BatchVerifyResult[]> {
  return Promise.all(
    items.map(async ({ selector, mode }) => {
      const result = await verifySelector(page, selector, mode)
      return { selector, mode, ...result }
    }),
  )
}
