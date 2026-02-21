export interface ProductData {
  url: string
  name: string | null
  price: string | null
  specs: Record<string, string>
  dimensions: Record<string, string>
  trialDays: number | null
  warrantyYears: number | null
  isProductPage: boolean
}

const PRODUCT_URL_RE = /\/(mattresses?|pillows?|beds?|furniture|sofas?|bed-frames?)(\/|$)/i

/** True when the current URL looks like a Wakefit product detail page */
export function isProductPage(url = location.href): boolean {
  return PRODUCT_URL_RE.test(new URL(url).pathname)
}

/**
 * Walks the live DOM and extracts structured product data.
 * Selectors are best-effort against Wakefit's current markup — they can be
 * tightened once the real page structure is confirmed.
 */
export function scanPage(): ProductData {
  const text = (sel: string) =>
    document.querySelector(sel)?.textContent?.trim() ?? null

  // ── Name ──────────────────────────────────────────────────────────────────
  const name =
    text('h1[class*="product"]') ??
    text('h1[class*="title"]') ??
    text('h1')

  // ── Price ─────────────────────────────────────────────────────────────────
  const price =
    text('[class*="selling-price"]') ??
    text('[class*="price"]') ??
    text('[data-testid="price"]')

  // ── Spec table / key-value pairs ──────────────────────────────────────────
  const specs: Record<string, string> = {}
  document.querySelectorAll('[class*="spec"] tr, [class*="specification"] tr').forEach((row) => {
    const cells = row.querySelectorAll('td, th')
    if (cells.length >= 2) {
      const key = cells[0].textContent?.trim()
      const val = cells[1].textContent?.trim()
      if (key && val) specs[key] = val
    }
  })

  // ── Dimensions ────────────────────────────────────────────────────────────
  const dimensions: Record<string, string> = {}
  document.querySelectorAll('[class*="dimension"] tr, [class*="size"] tr').forEach((row) => {
    const cells = row.querySelectorAll('td, th')
    if (cells.length >= 2) {
      const key = cells[0].textContent?.trim()
      const val = cells[1].textContent?.trim()
      if (key && val) dimensions[key] = val
    }
  })

  // ── Trial period ──────────────────────────────────────────────────────────
  const trialMatch = document.body.innerText.match(/(\d+)\s*-?\s*(?:night|day)\s*(?:free\s*)?trial/i)
  const trialDays = trialMatch ? parseInt(trialMatch[1], 10) : null

  // ── Warranty ──────────────────────────────────────────────────────────────
  const warrantyMatch = document.body.innerText.match(/(\d+)\s*(?:year|yr)s?\s*warranty/i)
  const warrantyYears = warrantyMatch ? parseInt(warrantyMatch[1], 10) : null

  return {
    url: location.href,
    name,
    price,
    specs,
    dimensions,
    trialDays,
    warrantyYears,
    isProductPage: isProductPage(),
  }
}
