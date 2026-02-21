/**
 * context-builder.ts — Compact LLM context from ProductPageData
 *
 * Token budget strategy (hard ceiling: 2000 tokens for Nano compatibility):
 *
 *   Reserve for user message      ~100 tokens
 *   Reserve for formatting/labels  ~50 tokens
 *   ─────────────────────────────────────────
 *   Available for product data    ~1850 tokens
 *
 *   Tier 1  Core identity (name, price)            always   ~60 t
 *   Tier 2  Purchase signals (trial, warranty, rating)  always   ~60 t
 *   Tier 3  Sizes (up to 4)                        always   ~80 t
 *   Tier 4  Highlights (up to 4, capped 120 t)     budget   120 t
 *   Tier 5  Specs (priority-sorted, capped 200 t)  budget   200 t
 *   Tier 6  pageText fallback (remaining, max 400t) budget   400 t
 *
 * Structured data always wins over raw page text.
 */

import type { ProductPageData } from '../content/modules/page-scanner'
import { formatRequirementsForPrompt } from '../store/user-requirements-store'
import { getSiteConfig } from '../store/site-config-store'

// ── Token estimation ──────────────────────────────────────────────────────────
// Rough heuristic: 1 token ≈ 4 chars for English text + numbers.
// Accurate enough for budget gating without a real tokeniser.

const CHARS_PER_TOKEN = 4
const MAX_TOKENS      = 2000

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN
  if (text.length <= maxChars) return text
  // Break on word boundary so we don't cut mid-word
  return text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…'
}

// ── Spec priority ─────────────────────────────────────────────────────────────
// Surface the most purchase-relevant specs first when budget is tight.

const PRIORITY_SPEC_KEYWORDS = [
  'thickness', 'height', 'layer', 'foam', 'material', 'cover',
  'comfort', 'support', 'firmness', 'weight', 'density',
]

function isPrioritySpec(key: string): boolean {
  const lower = key.toLowerCase()
  return PRIORITY_SPEC_KEYWORDS.some(k => lower.includes(k))
}

// ── Navigation graph helper ────────────────────────────────────────────────────

function buildNavContext(): string | null {
  const siteConfig = getSiteConfig()
  if (!siteConfig || !siteConfig.mainNav || siteConfig.mainNav.length === 0) return null

  const lines: string[] = ['SITE NAVIGATION:']
  for (const edge of siteConfig.mainNav.slice(0, 12)) {
    lines.push(`  - ${edge.label}: ${edge.href}`)
  }
  return lines.join('\n')
}

// ── Features context ──────────────────────────────────────────────────────────

function buildFeaturesContext(pageType: string): string | null {
  const siteConfig = getSiteConfig()
  if (!siteConfig?.features) return null

  const features = siteConfig.features[pageType as keyof typeof siteConfig.features]
  if (!features || features.length === 0) return null

  const lines: string[] = ['AVAILABLE FEATURES ON THIS PAGE:']
  for (const f of features.slice(0, 15)) {
    const opts = f.options?.slice(0, 5).map(o => o.label).join(', ')
    const method = f.interactionMethod !== 'none' ? ` [${f.interactionMethod}]` : ''
    lines.push(`  - ${f.name}${method}: ${f.description}${opts ? ` (${opts})` : ''}`)
  }
  return lines.join('\n')
}

// ── URL registry context ──────────────────────────────────────────────────────

function buildUrlRegistryContext(budget: number): string | null {
  const siteConfig = getSiteConfig()
  if (!siteConfig?.urlRegistry?.products?.length) return null

  const products = siteConfig.urlRegistry.products
  const maxProducts = Math.min(products.length, Math.floor(budget / 15))

  const lines: string[] = [`PRODUCT CATALOG (${products.length} total products):`]
  for (const p of products.slice(0, maxProducts)) {
    lines.push(`  - ${p.name} | ${p.category} | URL: ${p.url}`)
  }

  if (products.length > maxProducts) {
    lines.push(`  ... and ${products.length - maxProducts} more products`)
  }

  return lines.join('\n')
}

// ── Non-product pages ─────────────────────────────────────────────────────────

function buildNonProductContext(pageData: ProductPageData, budget: number): string {
  const lines: string[] = [
    `PAGE TYPE: ${pageData.pageType}`,
    `URL: ${pageData.url}`,
  ]
  budget -= estimateTokens(lines.join('\n'))

  const navContext = buildNavContext()
  if (navContext) {
    lines.push(navContext)
    budget -= estimateTokens(navContext)
  }

  // Features context (from SiteConfig)
  const featCtx = buildFeaturesContext(pageData.pageType)
  if (featCtx && budget > 100) {
    lines.push(featCtx)
    budget -= estimateTokens(featCtx)
  }

  // Home page
  if (pageData.pageType === 'home' && pageData.homeData) {
    const catLines = pageData.homeData.featuredCategories
      .slice(0, 8)
      .map(c => `  - ${c.name}: ${c.url}`)
    if (catLines.length > 0) {
      lines.push(`FEATURED CATEGORIES:\n${catLines.join('\n')}`)
    }
    if (pageData.homeData.promotions.length > 0) {
      lines.push(`PROMOTIONS: ${pageData.homeData.promotions.join(' | ')}`)
    }
  }

  // Category page: inject from page scan + supplement with URL registry
  if (pageData.pageType === 'category' && pageData.categoryData) {
    const cat = pageData.categoryData
    lines.push(`CATEGORY: ${cat.categoryName}`)

    // Merge scanned products with URL registry products (registry is authoritative)
    const siteConfig = getSiteConfig()
    const registryProducts = siteConfig?.urlRegistry?.products ?? []
    const scannedProducts = cat.products

    // Use scanned products first (they have accurate live data), supplement with registry
    const allProducts = [...scannedProducts]
    const seenUrls = new Set(scannedProducts.map(p => p.url))

    if (registryProducts.length > 0) {
      const categoryName = cat.categoryName.toLowerCase()
      for (const rp of registryProducts) {
        if (seenUrls.has(rp.url)) continue
        if (rp.category.toLowerCase().includes(categoryName) || categoryName.includes(rp.category.toLowerCase())) {
          allProducts.push({ name: rp.name, price: 0, url: rp.url })
          seenUrls.add(rp.url)
        }
      }
    }

    const prodLines = allProducts
      .slice(0, 15)
      .map((p, i) => `  ${i + 1}. ${p.name}${p.price ? ` — ₹${p.price.toLocaleString('en-IN')}` : ''}${('rating' in p && p.rating) ? ` ★${p.rating}` : ''} | URL: ${p.url}`)
    if (prodLines.length > 0) {
      lines.push(`PRODUCTS:\n${prodLines.join('\n')}`)
    }
    if (cat.availableFilters.length > 0) {
      lines.push(`FILTERS: ${cat.availableFilters.slice(0, 10).join(', ')}`)
    }
  }

  // For other pages, inject URL registry as product catalog
  if (pageData.pageType !== 'category' && pageData.pageType !== 'home') {
    const urlCtx = buildUrlRegistryContext(Math.min(budget / 2, 60))
    if (urlCtx) {
      lines.push(urlCtx)
      budget -= estimateTokens(urlCtx)
    }
  }

  if (pageData.pageText && budget > 50) {
    lines.push(`PAGE CONTENT:\n${truncateToTokens(pageData.pageText, Math.min(budget - 10, 400))}`)
  }

  return lines.join('\n')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a compact context string suitable for Nano's ~4K token window.
 *
 * Injects structured product data in priority order, then fills any
 * remaining budget with raw page text as a last-resort fallback.
 * Always includes the user's stored requirements so the LLM remembers
 * their preferences across page navigations.
 */
export function buildContextPrompt(
  pageData:    ProductPageData,
  userMessage: string,
): string {
  const userTokens  = estimateTokens(userMessage)
  const overhead    = 60 // labels, blank lines, "USER QUESTION:" prefix
  let   budget      = MAX_TOKENS - userTokens - overhead

  // Requirements are injected into every call so Claude/Gemini remembers them
  const reqContext = formatRequirementsForPrompt()

  // ── Non-product pages ───────────────────────────────────────────────────────
  if (pageData.pageType !== 'product' || !pageData.product) {
    const ctx = buildNonProductContext(pageData, budget)
    const req = reqContext ? `\n${reqContext}` : ''
    return `${ctx}${req}\n\nUSER QUESTION: ${userMessage}`
  }

  const p   = pageData.product
  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`
  const lines: string[] = []

  const consume = (line: string) => {
    lines.push(line)
    budget -= estimateTokens(line) + 1 // +1 for newline
  }

  // ── Tier 1: Core identity (~60 t) — always included ────────────────────────
  consume(`PRODUCT: ${p.name}`)

  const priceSuffix = p.originalPrice && p.originalPrice > p.price
    ? ` (MRP: ${fmt(p.originalPrice)})`
    : ''
  consume(`PRICE: ${fmt(p.price)}${priceSuffix}`)

  // ── Tier 2: Key purchase signals (~60 t) — always if present ───────────────
  if (p.trialPeriod) consume(`TRIAL: ${p.trialPeriod}`)
  if (p.warranty)    consume(`WARRANTY: ${p.warranty}`)
  if (p.rating)      consume(`RATING: ${p.rating}/5 (${p.reviewCount ?? '?'} reviews)`)

  // ── Tier 3: Sizes up to 4 (~80 t) — always if present ──────────────────────
  if (p.sizes.length > 0) {
    const sizeParts = p.sizes.slice(0, 4).map(s =>
      s.price > 0 ? `${s.label} (${fmt(s.price)})` : s.label,
    )
    consume(`SIZES: ${sizeParts.join(', ')}`)
  }

  // ── Tier 4: Highlights (cap 120 t) ─────────────────────────────────────────
  if (p.highlights.length > 0 && budget > 40) {
    const cap      = Math.min(budget * 0.25, 120)
    const included: string[] = []
    let   used     = 0

    for (const h of p.highlights) {
      const cost = estimateTokens(h) + 5 // bullet + spacing
      if (used + cost > cap) break
      included.push(`  • ${h}`)
      used += cost
    }

    if (included.length > 0) {
      consume(`HIGHLIGHTS:\n${included.join('\n')}`)
    }
  }

  // ── Tier 5: Specs priority-sorted (cap 200 t) ──────────────────────────────
  const specEntries = Object.entries(p.specifications)
  if (specEntries.length > 0 && budget > 40) {
    const cap      = Math.min(budget * 0.40, 200)
    const sorted   = [
      ...specEntries.filter(([k]) => isPrioritySpec(k)),
      ...specEntries.filter(([k]) => !isPrioritySpec(k)),
    ]
    const included: string[] = []
    let   used     = 0

    for (const [k, v] of sorted) {
      const line = `  ${k}: ${v}`
      const cost = estimateTokens(line) + 1
      if (used + cost > cap) break
      included.push(line)
      used += cost
    }

    if (included.length > 0) {
      consume(`SPECS:\n${included.join('\n')}`)
    }
  }

  // ── Tier 6: pageText fallback (remaining budget, max 400 t) ─────────────────
  // Only included when structured data is sparse (e.g., selectors found nothing).
  if (pageData.pageText && budget > 80) {
    const textBudget = Math.min(budget - 20, 400)
    consume(`PAGE CONTEXT:\n${truncateToTokens(pageData.pageText, textBudget)}`)
  }

  // ── Requirements context (always appended) ──────────────────────────────────
  if (reqContext) {
    lines.push('')
    lines.push(reqContext)
  }

  return `${lines.join('\n')}\n\nUSER QUESTION: ${userMessage}`
}
