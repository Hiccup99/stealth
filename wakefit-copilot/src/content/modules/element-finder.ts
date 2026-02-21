import { SELECTORS, type SelectorKey, splitSelectors } from './wakefit-selectors'
import { getSiteConfig } from '@/store/site-config-store'

// ── Intent → selector key map ────────────────────────────────────────────────
//
// Keys are lowercase, trimmed intent strings (or common aliases/synonyms).
// Values are SELECTORS keys.
//
// Add rows here whenever the agent gains a new intent — no other file changes.

const INTENT_MAP: Record<string, SelectorKey> = {
  // Product identity
  'title':           'productTitle',
  'name':            'productTitle',
  'product name':    'productTitle',
  'product title':   'productTitle',

  // Pricing
  'price':           'price',
  'cost':            'price',
  'selling price':   'price',
  'current price':   'price',
  'original price':  'originalPrice',
  'mrp':             'originalPrice',
  'strikethrough':   'originalPrice',

  // Ratings
  'rating':          'rating',
  'stars':           'rating',
  'review count':    'reviewCount',
  'reviews count':   'reviewCount',
  'number of reviews': 'reviewCount',

  // Sizes / variants
  'sizes':           'sizeSelector',
  'size':            'sizeSelector',
  'size options':    'sizeSelector',
  'size selector':   'sizeSelector',
  'variants':        'sizeSelector',
  'dimensions':      'dimensionChart',
  'dimension chart': 'dimensionChart',
  'size chart':      'dimensionChart',

  // Specs
  'specifications':  'specsSection',
  'specs':           'specsSection',
  'specification':   'specsSection',
  'product details': 'specsSection',
  'tech specs':      'specsSection',
  'specs table':     'specsTable',

  // Highlights / features
  'highlights':      'highlights',
  'features':        'highlights',
  'key features':    'highlights',
  'benefits':        'highlights',

  // Trust badges
  'trial':           'trialBanner',
  'trial period':    'trialBanner',
  'night trial':     'trialBanner',
  'free trial':      'trialBanner',
  'warranty':        'warrantyInfo',
  'guarantee':       'warrantyInfo',

  // Reviews
  'reviews':         'reviewSection',
  'review section':  'reviewSection',
  'customer reviews': 'reviewSection',

  // EMI / payment
  'emi':             'emiInfo',
  'payment':         'emiInfo',
  'payment options': 'emiInfo',

  // Images / gallery
  'images':          'productImages',
  'image':           'productImages',
  'gallery':         'productImages',
  'photos':          'productImages',
  'pictures':        'productImages',
  'product images':  'productImages',
  'product gallery': 'productImages',
  'image gallery':   'productImages',
  'photo gallery':   'productImages',

  // Category page
  'products':           'productCards',
  'product cards':      'productCards',
  'product list':       'productCards',
  'product listing':    'productCards',
  'listing':            'productCards',
  'catalog':            'productCards',
  'search results':     'productCards',
  'filters':            'filterSidebar',
  'filter':             'filterSidebar',
  'sidebar':            'filterSidebar',
  'filter options':     'filterSidebar',

  // Related
  'related':         'relatedContainer',
  'similar':         'relatedContainer',
  'related products': 'relatedContainer',
  'you may like':    'relatedContainer',
  'recommended':     'relatedContainer',
}

// ── Text-content keyword fallback ─────────────────────────────────────────────
//
// When no CSS selector matches, scan headings and labelling elements for
// recognisable section titles. Maps normalised intent → keyword list.

const TEXT_FALLBACK: Record<string, string[]> = {
  'specifications':   ['specification', 'product details', 'tech specs', 'details'],
  'specs':            ['specification', 'product details', 'tech specs', 'details'],
  'dimensions':       ['dimension', 'size chart', 'size guide', 'measurements'],
  'size chart':       ['size chart', 'size guide', 'dimension'],
  'trial':            ['trial', 'night trial', 'free trial', '100 night', 'sleep trial'],
  'trial period':     ['trial', 'night trial', 'free trial'],
  'warranty':         ['warranty', 'guarantee', 'year warranty'],
  'highlights':       ['highlights', 'key features', 'why buy', 'features', 'benefits'],
  'reviews':          ['reviews', 'customer reviews', 'ratings & reviews', 'what customers say'],
  'emi':              ['emi', 'easy payment', 'no cost emi', 'pay later'],
  'images':           ['images', 'gallery', 'photos', 'pictures', 'product images', 'image gallery'],
  'gallery':          ['gallery', 'images', 'photos', 'product images', 'image carousel'],
  'product images':   ['product images', 'gallery', 'images', 'photos', 'product photography'],
  'products':         ['products', 'mattress', 'bed', 'pillow', 'sofa', 'result', 'listing'],
  'product cards':    ['products', 'product', 'item', 'result', 'listing'],
  'filters':          ['filter', 'refine', 'sort'],
  'filter':           ['filter', 'refine'],
}

// Heading / label elements worth scanning for text-content matching
const HEADING_SELECTORS = 'h1, h2, h3, h4, h5, [class*="section-title"], [class*="sectionTitle"], ' +
  '[class*="heading"], [class*="label"], legend, summary'

// ── Internal helpers ─────────────────────────────────────────────────────────

function normalise(intent: string): string {
  return intent.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Try every selector in the chain (ordered), return the first matched element.
 * Unlike querySelector(multiSelector) — which picks by DOM order — this
 * respects our declared selector priority.
 */
function queryOrdered(selector: string): HTMLElement | null {
  for (const sel of splitSelectors(selector)) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return null
}

function queryAllOrdered(selector: string): HTMLElement[] {
  // Use multi-selector directly for "all" — we want every match, not priority
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
}

/**
 * Walk heading/label elements; return the parent section of the first heading
 * whose text contains one of the keywords.
 */
function findByTextContent(keywords: string[]): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll<HTMLElement>(HEADING_SELECTORS))

  for (const heading of headings) {
    const text = heading.textContent?.toLowerCase().trim() ?? ''
    if (keywords.some(kw => text.includes(kw))) {
      // Return the nearest ancestor that looks like a section container,
      // falling back to the heading's own parent
      return (
        heading.closest<HTMLElement>('section, article, [class*="section"], [class*="panel"], [class*="block"]') ??
        heading.parentElement ??
        heading
      )
    }
  }

  return null
}

// ── Public API ───────────────────────────────────────────────────────────────

const TAG = '[Wakefit Copilot · element-finder]'

/**
 * Find the single best-match DOM element for a semantic intent string.
 *
 * Resolution order:
 *   1. Exact INTENT_MAP key match
 *   2. Partial INTENT_MAP key match (intent contains a known key)
 *   3. CSS selector chain from SELECTORS (ordered)
 *   4. Text-content heading scan (TEXT_FALLBACK keywords)
 *   5. null
 */
export function findElement(intent: string): HTMLElement | null {
  const key = normalise(intent)

  // Step 1 — exact map lookup
  let selectorKey = INTENT_MAP[key]

  // Step 2 — partial match (e.g., "show me the trial period info" → 'trial period')
  if (!selectorKey) {
    for (const [mapKey, selKey] of Object.entries(INTENT_MAP)) {
      if (key.includes(mapKey) || mapKey.includes(key)) {
        selectorKey = selKey
        break
      }
    }
  }

  // Step 3a — SiteConfig remote selectors (highest fidelity when available)
  const siteConfig = getSiteConfig()
  if (siteConfig) {
    // SiteConfig v2: elements[key] is a SelectorEntry { selectors: string[], confidence, ... }
    // SiteConfig v1 (legacy): elements[key] was a plain string[]
    const entry = siteConfig.elements[key] ?? (selectorKey ? siteConfig.elements[selectorKey] : undefined)
    if (entry) {
      const selList: string[] = Array.isArray(entry)
        ? (entry as string[])
        : (entry as { selectors: string[] }).selectors ?? []
      for (const sel of selList) {
        try {
          const el = document.querySelector<HTMLElement>(sel)
          if (el) {
            console.debug(`${TAG} findElement("${intent}") → [site-config:${sel}]`, el)
            return el
          }
        } catch {
          // bad selector — skip
        }
      }
    }
  }

  // Step 3b — Built-in CSS selector chain (wakefit-selectors.ts)
  if (selectorKey) {
    const selector = SELECTORS[selectorKey]
    // sizePriceAttrs is not a CSS selector — skip
    if (selectorKey !== 'sizePriceAttrs') {
      const el = queryOrdered(selector)
      if (el) {
        console.debug(`${TAG} findElement("${intent}") → [selector:${selectorKey}]`, el)
        return el
      }
    }
  }

  // Step 4 — text-content heading scan
  const keywords = TEXT_FALLBACK[key]
  if (keywords) {
    const el = findByTextContent(keywords)
    if (el) {
      console.debug(`${TAG} findElement("${intent}") → [text-content fallback]`, el)
      return el
    }
  }

  // Fuzzy fallback: try TEXT_FALLBACK entries whose key overlaps the intent
  for (const [fbKey, kws] of Object.entries(TEXT_FALLBACK)) {
    if (key.includes(fbKey) || fbKey.includes(key)) {
      const el = findByTextContent(kws)
      if (el) {
        console.debug(`${TAG} findElement("${intent}") → [fuzzy text fallback:${fbKey}]`, el)
        return el
      }
    }
  }

  // Last resort: scan ALL visible block-level elements for keyword text
  const allKeywords = TEXT_FALLBACK[key] ?? [key]
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('section, article, div[id], div[class]')
  )
  for (const el of candidates) {
    if (el.offsetHeight < 20) continue  // skip tiny/hidden elements
    const text = (el.textContent ?? '').toLowerCase().slice(0, 200)
    if (allKeywords.some(kw => text.includes(kw))) {
      console.debug(`${TAG} findElement("${intent}") → [last-resort text scan]`, el)
      return el
    }
  }

  // Special case for images: if no container found, try finding the first large product image
  if (key === 'images' || key === 'gallery' || key.includes('image') || key.includes('photo')) {
    const imgSelectors = [
      'img[src*="product"]',
      'img[alt*="product" i]',
      'img[alt*="bed" i]',
      'img[alt*="mattress" i]',
      'img[class*="product"]',
      'img[class*="main"]',
      'img[class*="hero"]',
    ]
    for (const sel of imgSelectors) {
      const img = document.querySelector<HTMLImageElement>(sel)
      if (img && img.offsetWidth > 100 && img.offsetHeight > 100) {
        // Return the parent container (likely the gallery)
        const container = img.closest<HTMLElement>('div, section, figure, [class*="gallery"], [class*="image"]')
        if (container) {
          console.debug(`${TAG} findElement("${intent}") → [image fallback: parent container]`, container)
          return container
        }
        console.debug(`${TAG} findElement("${intent}") → [image fallback: image itself]`, img)
        return img
      }
    }
  }

  console.debug(`${TAG} findElement("${intent}") → null (no match)`)
  return null
}

/**
 * Return all matching elements for a semantic intent.
 * Useful for lists: size buttons, product cards, highlight bullets, etc.
 */
export function findAllElements(intent: string): HTMLElement[] {
  const key       = normalise(intent)
  const selectorKey = INTENT_MAP[key] ??
    Object.entries(INTENT_MAP).find(([k]) => key.includes(k) || k.includes(key))?.[1]

  if (selectorKey && selectorKey !== 'sizePriceAttrs') {
    const els = queryAllOrdered(SELECTORS[selectorKey])
    if (els.length > 0) {
      console.debug(`${TAG} findAllElements("${intent}") → ${els.length} element(s) [${selectorKey}]`)
      return els
    }
  }

  // Fallback: return all children of the single best match
  const parent = findElement(intent)
  if (parent) {
    const children = Array.from(parent.querySelectorAll<HTMLElement>('li, button, [role="option"]'))
    if (children.length > 0) return children
    return [parent]
  }

  console.debug(`${TAG} findAllElements("${intent}") → [] (no match)`)
  return []
}

/**
 * Returns the element's bounding box relative to the viewport.
 * Thin wrapper so callers don't need to null-check the return value.
 */
export function getBoundingBox(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect()
}

/**
 * Find a product card element by its href URL.
 * Used by open_product to locate the card before animating the cursor.
 */
export function findElementByUrl(url: string): HTMLElement | null {
  let targetPathname: string
  try {
    targetPathname = new URL(url).pathname
  } catch {
    targetPathname = url.startsWith('/') ? url : `/${url}`
  }

  // Strategy 1: Exact href match (escaped for CSS selector)
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exact = document.querySelector<HTMLAnchorElement>(`a[href="${escapedUrl}"]`)
  if (exact) {
    const card = exact.closest<HTMLElement>('[class*="product-card"],[class*="productCard"],[class*="product-item"],[class*="card"]')
    return card ?? exact
  }

  // Strategy 2: Pathname exact match (more flexible — ignores query params)
  const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
  const pathnameMatch = allLinks.find(a => {
    try {
      return new URL(a.href).pathname === targetPathname
    } catch {
      return false
    }
  })
  if (pathnameMatch) {
    const card = pathnameMatch.closest<HTMLElement>('[class*="product-card"],[class*="productCard"],[class*="product-item"],[class*="card"]')
    return card ?? pathnameMatch
  }

  // Strategy 3: Pathname contains match (for partial URLs)
  const partialMatch = allLinks.find(a => {
    try {
      const linkPath = new URL(a.href).pathname
      return linkPath.includes(targetPathname) || targetPathname.includes(linkPath)
    } catch {
      return false
    }
  })
  if (partialMatch) {
    const card = partialMatch.closest<HTMLElement>('[class*="product-card"],[class*="productCard"],[class*="product-item"],[class*="card"]')
    return card ?? partialMatch
  }

  return null
}

/**
 * Returns true if any part of the element is currently visible in the viewport.
 */
export function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  return (
    rect.bottom > 0 &&
    rect.right  > 0 &&
    rect.top    < (window.innerHeight || document.documentElement.clientHeight) &&
    rect.left   < (window.innerWidth  || document.documentElement.clientWidth)
  )
}
