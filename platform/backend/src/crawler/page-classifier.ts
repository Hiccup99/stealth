/**
 * page-classifier.ts
 *
 * Classifies a Playwright page into a PageTypeKey using:
 *  1. JSON-LD @type (definitive — no ambiguity)
 *  2. URL pattern scoring (generic, vertical-agnostic)
 *  3. DOM signature heuristics as tiebreaker
 *
 * Completely generic — no e-commerce vertical hardcoding.
 */

import type { Page } from 'playwright'
import type { PageTypeKey, PageTypeRule } from '../shared-types'

const TAG = '[page-classifier]'

// ── JSON-LD extraction ────────────────────────────────────────────────────────

interface JsonLdNode {
  '@type'?: string | string[]
  '@context'?: string
  [key: string]: unknown
}

async function extractJsonLdTypes(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]')
      const types: string[] = []
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent ?? '{}')
          const nodes: unknown[] = Array.isArray(data)
            ? data
            : data['@graph']
            ? (data['@graph'] as unknown[])
            : [data]

          for (const node of nodes) {
            const n = node as Record<string, unknown>
            const t = n['@type']
            if (typeof t === 'string') types.push(t)
            else if (Array.isArray(t)) types.push(...(t as string[]))
          }
        } catch {
          // malformed JSON — skip
        }
      }
      return types
    })
  } catch {
    return []
  }
}

/**
 * Map JSON-LD @type values to PageTypeKey.
 * Uses schema.org vocabulary.
 */
function jsonLdTypeToPageType(types: string[]): PageTypeKey | null {
  const normalized = types.map(t => t.toLowerCase())

  // Definitive product signals
  if (normalized.some(t => t === 'product' || t === 'offer' || t === 'individualoffer')) {
    return 'product'
  }

  // Definitive category / collection signals
  if (normalized.some(t =>
    t === 'itemlist' || t === 'collectionpage' || t === 'productcollection' ||
    t === 'offeraggregate' || t === 'aggregateoffer'
  )) {
    return 'category'
  }

  // Cart / checkout
  if (normalized.some(t => t === 'order' || t === 'cart' || t === 'checkout')) {
    return 'cart'
  }

  // Home / website
  if (normalized.some(t => t === 'website' || t === 'webpage' || t === 'webapplication')) {
    return 'home'
  }

  // Search results
  if (normalized.some(t => t === 'searchresultspage')) {
    return 'search'
  }

  return null
}

// ── URL pattern scoring ───────────────────────────────────────────────────────

/**
 * Score a URL for each page type without vertical-specific keywords.
 *
 * Returns the best-scoring type or 'other'.
 */
function scoreUrlByType(urlStr: string): PageTypeKey {
  try {
    const url = new URL(urlStr)
    const { pathname, search } = url
    const lower = pathname.toLowerCase()
    const parts = pathname.split('/').filter(Boolean)

    // ── Cart ─────────────────────────────────────────────────────────────────
    if (/\/(cart|basket|bag|trolley)(\/|$)/.test(lower)) return 'cart'

    // ── Search ───────────────────────────────────────────────────────────────
    if (/\/(search|find|results?)(\/|$)/.test(lower) || search.includes('q=') || search.includes('query=')) return 'search'

    // ── Utility pages (skip) ─────────────────────────────────────────────────
    if (/\/(login|signin|signup|register|account|profile|orders?|wishlist|checkout|payment|thank-you|confirmation|404|about|blog|faq|policy|policies|terms|privacy|contact|careers|press|investor)/i.test(lower)) {
      return 'other'
    }

    // ── Home ─────────────────────────────────────────────────────────────────
    if (parts.length === 0) return 'home'

    // ── Product page signals ─────────────────────────────────────────────────
    // 3+ path segments usually indicates a product
    if (parts.length >= 3) return 'product'

    if (parts.length >= 2) {
      const lastSegment = parts[parts.length - 1]
      // Long slugs with digits → likely a product SKU or model
      if (/[A-Z0-9]{4,}/.test(lastSegment)) return 'product'
      // Very long slug (15+ chars with dashes) → product name slug
      if (/^[a-z0-9][a-z0-9-]{14,}$/.test(lastSegment)) return 'product'
    }

    // ── Category page ────────────────────────────────────────────────────────
    if (parts.length === 1) return 'category'
    if (parts.length === 2) return 'category'

    return 'other'
  } catch {
    return 'other'
  }
}

// ── DOM signature heuristics ──────────────────────────────────────────────────

const DOM_SIGNATURES: Record<PageTypeKey, string[]> = {
  product: [
    'button[class*="add-to-cart"]',
    'button[class*="addToCart"]',
    'button[name="add"]',
    '[data-testid="add-to-cart"]',
    '[itemType*="Product"]',
  ],
  category: [
    '[class*="product-card"]',
    '[class*="productCard"]',
    '[class*="product-grid"]',
    '[data-testid="product-card"]',
    '[class*="product-listing"]',
  ],
  cart: [
    '[class*="cart-item"]',
    '[class*="cartItem"]',
    '[data-testid="cart-item"]',
    'button[class*="checkout"]',
  ],
  search: [
    '[class*="search-results"]',
    '[class*="searchResults"]',
    '[data-testid="search-results"]',
  ],
  home: [
    '[class*="hero-banner"]',
    '[class*="heroBanner"]',
    '[class*="homepage"]',
    '[class*="home-page"]',
  ],
  other: [],
}

async function detectDomType(page: Page): Promise<PageTypeKey | null> {
  for (const [type, selectors] of Object.entries(DOM_SIGNATURES) as [PageTypeKey, string[]][]) {
    if (selectors.length === 0) continue
    for (const sel of selectors) {
      try {
        const count = await page.locator(sel).count()
        if (count > 0) return type
      } catch {
        // bad selector — skip
      }
    }
  }
  return null
}

// ── URL pattern builder ───────────────────────────────────────────────────────

/** Build a regex URL pattern from a confirmed page URL */
function buildUrlPattern(urlStr: string): string {
  try {
    const { pathname } = new URL(urlStr)
    const parts = pathname.split('/').filter(Boolean)
    if (parts.length === 0) return '^\\/?$'
    // Escape and replace final segment with wildcard
    const escaped = parts
      .slice(0, -1)
      .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const prefix = escaped.length > 0 ? `\\/${escaped.join('\\/')}` : ''
    return `${prefix}\\/[^/]+`
  } catch {
    return '.*'
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  type: PageTypeKey
  rule: PageTypeRule
  /** How the classification was determined */
  method: 'jsonld' | 'url' | 'dom' | 'fallback'
}

export async function classifyPage(
  page: Page,
  urlStr: string,
  log?: (msg: string) => void,
): Promise<ClassificationResult> {
  const emit = (msg: string) => log && log(`${TAG} ${msg}`)

  // ── 1. JSON-LD (most reliable) ────────────────────────────────────────────
  const jsonLdTypes = await extractJsonLdTypes(page)
  if (jsonLdTypes.length > 0) {
    emit(`JSON-LD types: ${jsonLdTypes.join(', ')}`)
    const type = jsonLdTypeToPageType(jsonLdTypes)
    if (type) {
      return {
        type,
        method: 'jsonld',
        rule: {
          urlPattern: buildUrlPattern(urlStr),
          jsonLdType: jsonLdTypes[0],
          label: capitalize(type),
          confidence: 95,
        },
      }
    }
  }

  // ── 2. URL pattern ────────────────────────────────────────────────────────
  const urlType = scoreUrlByType(urlStr)
  if (urlType !== 'other') {
    emit(`URL classification: ${urlType} for ${new URL(urlStr).pathname}`)
    return {
      type: urlType,
      method: 'url',
      rule: {
        urlPattern: buildUrlPattern(urlStr),
        label: capitalize(urlType),
        confidence: 70,
      },
    }
  }

  // ── 3. DOM heuristics ─────────────────────────────────────────────────────
  const domType = await detectDomType(page)
  if (domType) {
    emit(`DOM classification: ${domType}`)
    return {
      type: domType,
      method: 'dom',
      rule: {
        urlPattern: buildUrlPattern(urlStr),
        label: capitalize(domType),
        confidence: 55,
      },
    }
  }

  // ── 4. Fallback ───────────────────────────────────────────────────────────
  emit(`fallback: other for ${urlStr}`)
  return {
    type: 'other',
    method: 'fallback',
    rule: {
      urlPattern: '.*',
      label: 'Other',
      confidence: 0,
    },
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
