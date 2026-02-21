import { SELECTORS, splitSelectors } from './wakefit-selectors'
import { getSiteConfig } from '@/store/site-config-store'

// ── Public types ────────────────────────────────────────────────────────────

export interface ProductSize {
  label: string
  dimensions: string
  price: number
}

export interface ProductData {
  name: string
  price: number
  originalPrice?: number
  rating?: number
  reviewCount?: number
  sizes: ProductSize[]
  specifications: Record<string, string>
  trialPeriod?: string
  warranty?: string
  highlights: string[]
}

export interface RelatedProduct {
  name: string
  price: number
  url: string
}

export type PageType = 'home' | 'product' | 'category' | 'cart' | 'other'

export interface CategoryProduct {
  name:    string
  price:   number
  rating?: number
  url:     string
}

export interface FeaturedCategory {
  name: string
  url:  string
}

export interface HomePageData {
  featuredCategories: FeaturedCategory[]
  promotions:         string[]
}

export interface CategoryPageData {
  categoryName:    string
  products:        CategoryProduct[]
  availableFilters: string[]
}

export interface ProductPageData {
  url: string
  pageType: PageType
  product?: ProductData
  relatedProducts?: RelatedProduct[]
  /** Populated on 'home' pages */
  homeData?: HomePageData
  /** Populated on 'category' pages */
  categoryData?: CategoryPageData
  /** Truncated visible text — LLM fallback when structured extraction is sparse */
  pageText: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Query the first matching element and return its trimmed text.
 * Accepts a multi-selector string ("a, b, c") — querySelector already tries
 * all of them and returns the first DOM match.
 */
function firstText(selector: string): string | undefined {
  return document.querySelector(selector)?.textContent?.trim() || undefined
}

/**
 * Like firstText, but iterates selectors one-by-one in declared order
 * (not DOM order). Use when selector priority matters more than DOM position.
 */
function firstTextOrdered(selector: string): string | undefined {
  for (const sel of splitSelectors(selector)) {
    const t = document.querySelector(sel)?.textContent?.trim()
    if (t) return t
  }
}

/** Parse a localised price string ("₹12,999", "12999.00") to a number */
function parsePrice(raw: string | undefined): number {
  if (!raw) return 0
  const n = parseFloat(raw.replace(/[₹,\s]/g, '').trim())
  return isNaN(n) ? 0 : n
}

/** Read the first defined data attribute from sizePriceAttrs config */
function readSizePriceAttr(el: Element): string | undefined {
  for (const attr of splitSelectors(SELECTORS.sizePriceAttrs)) {
    const v2 = el.getAttribute(attr)
    if (v2) return v2
    // also check dataset (camelCase form)
    const key = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    const v1  = (el as HTMLElement).dataset[key]
    if (v1) return v1
  }
}

// ── Page-type detection ──────────────────────────────────────────────────────

const PAGE_TYPE_ROUTES: Array<{ re: RegExp; type: PageType }> = [
  { re: /^\/cart\/?/i,                                                                               type: 'cart' },
  { re: /^\/(mattresses?|pillows?|beds?|bed-frames?|sofas?|furniture|bedsheets?|cushions?)\/.+/i,   type: 'product' },
  { re: /^\/(mattresses?|pillows?|beds?|bed-frames?|sofas?|furniture|bedsheets?|cushions?)\/?$/i,   type: 'category' },
  { re: /^\/?$|^\/home\/?$/i,                                                                        type: 'home' },
]

/**
 * Detect product page by DOM heuristics (add-to-cart, product title, price, etc.)
 * Used as fallback when URL pattern doesn't match.
 */
function isProductPageByDOM(): boolean {
  // Check for strong product page indicators
  const hasAddToCart = document.querySelector(
    'button[class*="add-to-cart"], button[class*="addToCart"], ' +
    '[data-testid*="add-to-cart"], button[name="add"], ' +
    '[aria-label*="add to cart" i]'
  ) !== null
  
  const hasProductTitle = document.querySelector(
    'h1[class*="product"], h1[class*="pdp"], ' +
    '[class*="product-title"], [class*="productTitle"], ' +
    '[itemProp="name"]'
  ) !== null
  
  const hasPrice = document.querySelector(
    '[class*="price"], [class*="Price"], ' +
    '[data-testid*="price"], [itemProp="price"]'
  ) !== null
  
  // If we have 2+ indicators, it's likely a product page
  const indicators = [hasAddToCart, hasProductTitle, hasPrice].filter(Boolean).length
  return indicators >= 2
}

function detectPageType(): PageType {
  const currentUrl = location.href
  const { pathname } = new URL(currentUrl)
  const siteConfig = getSiteConfig()

  // 1. Check URL registry validated patterns (highest quality — derived from actual URLs)
  if (siteConfig?.urlRegistry?.validatedPatterns) {
    for (const vp of siteConfig.urlRegistry.validatedPatterns) {
      try {
        const re = new RegExp(vp.pattern, 'i')
        if (re.test(pathname)) {
          const pageType = vp.pageType as PageType
          // Override: if pattern says category but DOM shows product page
          if (pageType === 'category' && isProductPageByDOM()) return 'product'
          return pageType
        }
      } catch { /* skip */ }
    }
  }

  // 2. Check URL against product URL registry (exact match = definitely product)
  if (siteConfig?.urlRegistry?.products) {
    const cleanUrl = new URL(currentUrl).origin + pathname
    const match = siteConfig.urlRegistry.products.some(p => {
      try {
        const pPath = new URL(p.url).pathname
        return pPath === pathname || cleanUrl === p.url
      } catch { return false }
    })
    if (match) return 'product'
  }

  // 3. SiteConfig page type rules (legacy v2)
  if (siteConfig) {
    for (const [typeKey, rule] of Object.entries(siteConfig.pageTypes)) {
      if (!rule?.urlPattern) continue
      try {
        const re = new RegExp(rule.urlPattern, 'i')
        if (!re.test(pathname)) continue
        if (rule.domSignature) {
          const el = document.querySelector(rule.domSignature)
          if (!el) continue
        }
        if (typeKey === 'category' && isProductPageByDOM()) return 'product'
        return typeKey as PageType
      } catch { /* skip */ }
    }
  }
  
  // 4. DOM heuristics fallback
  if (isProductPageByDOM()) return 'product'

  // 5. Built-in route patterns
  for (const { re, type } of PAGE_TYPE_ROUTES) {
    if (re.test(pathname)) return type
  }

  return 'other'
}

// ── Home page extraction ─────────────────────────────────────────────────────

function scrapeHomeData(): HomePageData {
  // Featured categories: nav links, category cards, hero CTAs
  const categorySelectors = [
    'nav a[href*="/mattress"]', 'nav a[href*="/bed"]', 'nav a[href*="/pillow"]',
    'nav a[href*="/sofa"]', 'nav a[href*="/furniture"]', 'nav a[href*="/bedsheet"]',
    '[class*="category"] a', '[class*="nav-item"] a', '[class*="menu-item"] a',
  ]
  const seenCatUrls = new Set<string>()
  const featuredCategories: FeaturedCategory[] = []
  for (const sel of categorySelectors) {
    document.querySelectorAll<HTMLAnchorElement>(sel).forEach(a => {
      const name = a.textContent?.trim()
      const url  = a.href
      if (name && url && name.length > 1 && name.length < 40 && !seenCatUrls.has(url)) {
        seenCatUrls.add(url)
        featuredCategories.push({ name, url })
      }
    })
    if (featuredCategories.length >= 10) break
  }

  // Promotions: banners, sale text, offer headings
  const promotionSelectors = [
    '[class*="banner"] h1, [class*="banner"] h2, [class*="banner"] p',
    '[class*="promo"] h2, [class*="offer"] h2',
    '[class*="hero"] h1, [class*="hero"] h2',
    '[class*="sale"] h2',
  ]
  const seenPromos = new Set<string>()
  const promotions: string[] = []
  for (const sel of promotionSelectors) {
    document.querySelectorAll(sel).forEach(el => {
      const text = el.textContent?.trim()
      if (text && text.length > 5 && text.length < 150 && !seenPromos.has(text)) {
        seenPromos.add(text)
        promotions.push(text)
      }
    })
  }

  return { featuredCategories: featuredCategories.slice(0, 10), promotions: promotions.slice(0, 5) }
}

// ── Category page extraction ─────────────────────────────────────────────────

function scrapeCategoryData(): CategoryPageData {
  // Category name from heading or breadcrumb
  const categoryName =
    document.querySelector<HTMLElement>('h1')?.textContent?.trim() ??
    document.querySelector<HTMLElement>('[class*="category-title"], [class*="page-title"], [class*="breadcrumb"] li:last-child')?.textContent?.trim() ??
    document.title.split('|')[0].trim()

  // Product cards
  const cardSelectors = [
    '[class*="product-card"]',
    '[class*="productCard"]',
    '[class*="product-item"]',
    '[class*="productItem"]',
    '[class*="card-item"]',
  ]
  const products: CategoryProduct[] = []
  const seenUrls = new Set<string>()

  for (const sel of cardSelectors) {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(sel))
    if (cards.length === 0) continue

    for (const card of cards) {
      // Find all links in the card — prefer the main product link over quick-view/action links
      const allLinks = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))
      
      // Strategy: Find the link that looks like a product page URL
      // - Prefer links that wrap or are near the product image
      // - Prefer links that wrap or are near the product title/name
      // - Prefer links with longer paths (product URLs are usually /category/product-slug/SKU)
      // - Avoid links with "quick-view", "wishlist", "compare", etc. in class/id
      let link: HTMLAnchorElement | undefined = allLinks
        .map(a => {
          const href = a.href
          const classes = (a.className || '').toLowerCase()
          const id = (a.id || '').toLowerCase()
          const pathname = new URL(href).pathname
          
          // Skip action links
          if (classes.includes('quick-view') || classes.includes('wishlist') || 
              classes.includes('compare') || classes.includes('share') ||
              classes.includes('add-to-cart') || classes.includes('buy-now') ||
              id.includes('quick') || id.includes('wishlist') || id.includes('compare')) {
            return null
          }
          
          // Skip non-product links (cart, account, etc.)
          if (pathname.includes('/cart') || pathname.includes('/account') || 
              pathname.includes('/checkout') || pathname.includes('/login')) {
            return null
          }
          
          // Score the link
          let score = 0
          const segments = pathname.split('/').filter(Boolean)
          
          // Higher score for longer paths (product pages have 2+ segments, often 3 with SKU)
          score += segments.length * 15
          
          // Big bonus for URLs with SKU pattern (e.g., /WEPSM72366, /WEMB12345)
          // Wakefit SKUs are typically 8-10 alphanumeric chars at the end
          const lastSegment = segments[segments.length - 1] || ''
          if (/^[A-Z0-9]{6,12}$/.test(lastSegment)) {
            score += 100  // Strong indicator this is the main product URL
          }
          
          // Bonus for product-like paths
          if (pathname.includes('/mattress/') || pathname.includes('/bed/') || 
              pathname.includes('/pillow/') || pathname.includes('/sofa/')) {
            score += 50
          }
          
          // Penalty for URLs that look like category pages (single segment)
          if (segments.length === 1) {
            score -= 30
          }
          
          // Bonus if link wraps or contains product image
          const hasImage = a.querySelector('img') !== null || 
                          a.closest('[class*="image"], [class*="img"]') !== null
          if (hasImage) score += 30
          
          // Bonus if link wraps or contains product name/title
          const hasTitle = a.querySelector('h2, h3, h4, [class*="name"], [class*="title"]') !== null ||
                         a.closest('[class*="name"], [class*="title"]') !== null
          if (hasTitle) score += 30
          
          // Bonus for larger clickable area (main links are usually bigger)
          const rect = a.getBoundingClientRect()
          const area = rect.width * rect.height
          score += Math.min(area / 100, 20) // Cap at 20 points
          
          return { link: a, score }
        })
        .filter((item): item is { link: HTMLAnchorElement; score: number } => item !== null)
        .sort((a, b) => b.score - a.score)[0]?.link
      
      // Fallback to first link if no product-like link found
      if (!link && allLinks.length > 0) {
        link = allLinks[0]
      }
      
      if (!link) continue
      
      // Normalize to absolute URL (href is already absolute, but ensure it's valid)
      let url: string
      try {
        const urlObj = new URL(link.href)
        url = urlObj.href
      } catch {
        // If href is relative, make it absolute
        try {
          url = new URL(link.href, window.location.origin).href
        } catch {
          continue // Skip invalid URLs
        }
      }
      
      if (!url || seenUrls.has(url)) continue
      seenUrls.add(url)

      const nameEl  = card.querySelector('[class*="name"], [class*="title"], h2, h3, h4')
      
      // Debug: log extracted URLs to verify correct link selection
      if (products.length < 3) {
        const name = nameEl?.textContent?.trim() || 'unnamed'
        console.debug(`[page-scanner] Product ${products.length + 1}: "${name}" → ${url}`)
      }
      const priceEl = card.querySelector('[class*="price"], [class*="Price"]')
      const ratingEl= card.querySelector('[class*="rating"], [aria-label*="rating" i]')

      const name    = nameEl?.textContent?.trim() ?? ''
      const price   = parsePrice(priceEl?.textContent)
      const ratingTxt = ratingEl?.textContent?.trim() ?? ratingEl?.getAttribute('aria-label') ?? ''
      const ratingMatch = ratingTxt.match(/([\d.]+)/)
      const rating  = ratingMatch ? parseFloat(ratingMatch[1]) : undefined

      if (name) products.push({ name, price, rating, url })
      if (products.length >= 12) break
    }
    if (products.length >= 4) break
  }

  // Available filters
  const filterSelectors = [
    '[class*="filter"] label, [class*="filter"] button',
    '[class*="facet"] label',
    '[class*="sidebar"] label, [class*="sidebar"] button',
  ]
  const filters: string[] = []
  const seenFilters = new Set<string>()
  for (const sel of filterSelectors) {
    document.querySelectorAll(sel).forEach(el => {
      const text = el.textContent?.trim()
      if (text && text.length > 0 && text.length < 50 && !seenFilters.has(text)) {
        seenFilters.add(text)
        filters.push(text)
      }
    })
    if (filters.length >= 20) break
  }

  return {
    categoryName,
    products:         products.slice(0, 12),
    availableFilters: filters.slice(0, 20),
  }
}

// ── Layer 1: JSON-LD structured data ────────────────────────────────────────

type JsonObject = Record<string, unknown>

function findProductNode(obj: unknown): JsonObject | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as JsonObject
  if (o['@type'] === 'Product') return o
  if (Array.isArray(o['@graph'])) {
    for (const item of (o['@graph'] as unknown[])) {
      const hit = findProductNode(item)
      if (hit) return hit
    }
  }
  return null
}

function parseOffer(offer: unknown): { price: number; originalPrice?: number } {
  if (!offer || typeof offer !== 'object') return { price: 0 }
  const o = offer as JsonObject
  const price = parsePrice(String(o['price'] ?? ''))
  const offers = o['offers']
  if (Array.isArray(offers) && offers.length > 0) {
    const prices = (offers as JsonObject[])
      .map(of => parsePrice(String(of['price'] ?? '')))
      .filter(Boolean)
    if (prices.length) return { price: Math.min(...prices) }
  }
  return { price }
}

function parseJsonLd(): Partial<ProductData> | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]')
  for (const script of Array.from(scripts)) {
    let parsed: unknown
    try { parsed = JSON.parse(script.textContent ?? '') } catch { continue }

    const items = Array.isArray(parsed) ? parsed : [parsed]
    for (const item of items) {
      const node = findProductNode(item)
      if (!node) continue

      const { price, originalPrice } = parseOffer(node['offers'])
      const rating = node['aggregateRating'] as JsonObject | undefined
      const desc   = String(node['description'] ?? '')

      return {
        name:           String(node['name'] ?? '').trim() || undefined,
        price,
        originalPrice,
        rating:         rating ? parseFloat(String(rating['ratingValue'] ?? '')) || undefined : undefined,
        reviewCount:    rating ? parseInt(String(rating['reviewCount'] ?? ''), 10) || undefined : undefined,
        highlights:     desc
          ? desc.split(/[.\n]/).map(s => s.trim()).filter(s => s.length > 20).slice(0, 5)
          : [],
        sizes:          [],
        specifications: {},
      }
    }
  }
  return null
}

// ── Layer 2: Semantic HTML / microdata ──────────────────────────────────────

function parseSemanticHtml(): Partial<ProductData> {
  const result: Partial<ProductData> = {}

  const nameProp  = document.querySelector('[itemProp="name"]')?.textContent?.trim()
  const priceProp = document.querySelector('[itemProp="price"]')?.getAttribute('content')
    ?? document.querySelector('[itemProp="price"]')?.textContent?.trim()

  if (nameProp)  result.name  = nameProp
  if (priceProp) result.price = parsePrice(priceProp)

  const ogPrice = document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content')
  if (ogPrice && !result.price) result.price = parsePrice(ogPrice)

  const ratingEl = document.querySelector('[aria-label*="rating" i], [aria-label*="stars" i]')
  if (ratingEl) {
    const m = ratingEl.getAttribute('aria-label')?.match(/([\d.]+)/)
    if (m) result.rating = parseFloat(m[1])
  }

  return result
}

// ── Layer 3: Wakefit-specific DOM scraping ───────────────────────────────────

function scrapeProductName():    string | undefined { return firstTextOrdered(SELECTORS.productTitle) }
function scrapePrice():          number             { return parsePrice(firstText(SELECTORS.price)) }
function scrapeOriginalPrice():  number | undefined {
  const p = parsePrice(firstTextOrdered(SELECTORS.originalPrice))
  return p > 0 ? p : undefined
}
function scrapeRating():         number | undefined {
  const t = firstText(SELECTORS.rating)
  const n = t ? parseFloat(t) : NaN
  return isNaN(n) ? undefined : n
}
function scrapeReviewCount():    number | undefined {
  const t = firstText(SELECTORS.reviewCount)
  const n = t ? parseInt(t.replace(/[^\d]/g, ''), 10) : NaN
  return isNaN(n) ? undefined : n
}
function scrapeTrialPeriod():    string | undefined {
  const direct = firstText(SELECTORS.trialBanner)
  if (direct) return direct
  const m = document.body.innerText.match(/(\d+)[- ]?(?:night|day)[- ]?(?:free[- ]?)?trial/i)
  return m ? m[0] : undefined
}
function scrapeWarranty():       string | undefined {
  const direct = firstText(SELECTORS.warrantyInfo)
  if (direct) return direct
  const m = document.body.innerText.match(/(\d+)[- ]?(?:year|yr)s?[- ]?warranty/i)
  return m ? m[0] : undefined
}

function scrapeHighlights(): string[] {
  // Iterate selectors in declared order — earlier selectors are more specific
  for (const sel of splitSelectors(SELECTORS.highlights)) {
    const items = Array.from(document.querySelectorAll(sel))
      .map(el => el.textContent?.trim() ?? '')
      .filter(t => t.length > 5)
    if (items.length >= 2) return items.slice(0, 8)
  }
  return []
}

// ── Specifications ───────────────────────────────────────────────────────────

function scrapeSpecifications(): Record<string, string> {
  const specs: Record<string, string> = {}

  // Strategy A: <table>/<tr> inside any spec section selector
  const specContainerSelectors = [
    ...splitSelectors(SELECTORS.specsTable),
    ...splitSelectors(SELECTORS.specsSection),
  ]
  for (const containerSel of specContainerSelectors) {
    const container = document.querySelector(containerSel)
    if (!container) continue

    container.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td, th')
      if (cells.length >= 2) {
        const key = cells[0].textContent?.trim()
        const val = cells[cells.length - 1].textContent?.trim()
        if (key && val && key !== val && key.length < 80) specs[key] = val
      }
    })
    if (Object.keys(specs).length >= 2) return specs
  }

  // Strategy B: <dl> / <dt> + <dd> pairs
  for (const dlSel of splitSelectors(SELECTORS.specsDl)) {
    const dl = document.querySelector(dlSel)
    if (!dl) continue
    const dts = Array.from(dl.querySelectorAll('dt'))
    const dds = Array.from(dl.querySelectorAll('dd'))
    for (let i = 0; i < Math.min(dts.length, dds.length); i++) {
      const key = dts[i].textContent?.trim()
      const val = dds[i].textContent?.trim()
      if (key && val) specs[key] = val
    }
    if (Object.keys(specs).length >= 2) return specs
  }

  // Strategy C: any 2-cell <tr> on the page
  document.querySelectorAll('table tr').forEach(row => {
    const cells = row.querySelectorAll('td')
    if (cells.length === 2) {
      const key = cells[0].textContent?.trim()
      const val = cells[1].textContent?.trim()
      if (key && val && key.length < 60) specs[key] = val
    }
  })

  return specs
}

// ── Sizes ────────────────────────────────────────────────────────────────────

const DIMENSION_RE = /\d+\s*[x×]\s*\d+|\b(king|queen|single|double|twin|full|small|large)\b|\d+\s*(?:inch|cm)/i

function scrapeSizes(): ProductSize[] {
  // sizeSelector already includes "container button" compound selectors
  const sizeEls = Array.from(document.querySelectorAll(SELECTORS.sizeSelector))
  if (sizeEls.length === 0) return []

  const sizes: ProductSize[] = []
  for (const btn of sizeEls) {
    const label = btn.textContent?.trim() ?? ''
    if (!label || label.length > 80) continue

    const dimension =
      btn.getAttribute('aria-label') ??
      btn.getAttribute('title') ??
      (DIMENSION_RE.test(label) ? label : '')

    const rawPrice = readSizePriceAttr(btn)
    sizes.push({ label, dimensions: dimension.trim(), price: parsePrice(rawPrice) })
  }

  return sizes
}

// ── Related products ─────────────────────────────────────────────────────────

function scrapeRelatedProducts(): RelatedProduct[] {
  for (const containerSel of splitSelectors(SELECTORS.relatedContainer)) {
    const container = document.querySelector(containerSel)
    if (!container) continue

    const related: RelatedProduct[] = []
    container.querySelectorAll(SELECTORS.relatedCard).forEach(card => {
      const name  = card.querySelector(SELECTORS.relatedName)?.textContent?.trim()
      const price = parsePrice(card.querySelector(SELECTORS.price)?.textContent)
      const href  = (card.querySelector('a') as HTMLAnchorElement | null)?.href
      if (name && href) related.push({ name, price, url: href })
    })

    if (related.length >= 1) return related.slice(0, 6)
  }
  return []
}

// ── Page text fallback ────────────────────────────────────────────────────────

function extractPageText(maxChars = 3000): string {
  // Use textContent (faster) instead of innerText (triggers layout)
  const main =
    document.querySelector('main') ??
    document.querySelector('[class*="product-detail"]') ??
    document.querySelector('[class*="pdp"]') ??
    document.body
  return (main.textContent ?? '')
    .replace(/\s{3,}/g, '\n')
    .trim()
    .slice(0, maxChars)
}

// ── Merge layers (lower index = higher priority) ─────────────────────────────

function merge<T>(layers: Partial<T>[]): T {
  const result: Partial<T> = {}
  for (const layer of layers) {
    for (const _k in layer) {
      const k = _k as keyof T
      const v = layer[k]
      if (
        v !== undefined && v !== null && v !== 0 && v !== '' &&
        !(Array.isArray(v) && (v as unknown[]).length === 0) &&
        !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
      ) {
        if (result[k] === undefined) (result as Record<keyof T, unknown>)[k] = v
      }
    }
  }
  return result as T
}

// ── Public API ────────────────────────────────────────────────────────────────

const TAG = '[Wakefit Copilot · scanner]'

export function scan(): ProductPageData {
  const url      = location.href
  const pageType = detectPageType()

  console.debug(`${TAG} scanning — pageType: ${pageType}, url: ${url}`)

  // ── Home page ──────────────────────────────────────────────────────────────
  if (pageType === 'home') {
    const homeData = scrapeHomeData()
    const pageText = extractPageText(1000)
    console.debug(`${TAG} home page — categories: ${homeData.featuredCategories.length}, promos: ${homeData.promotions.length}`)
    return { url, pageType, homeData, pageText }
  }

  // ── Category page ──────────────────────────────────────────────────────────
  if (pageType === 'category') {
    const categoryData = scrapeCategoryData()
    const pageText = extractPageText(800)
    console.debug(`${TAG} category page — "${categoryData.categoryName}", products: ${categoryData.products.length}`)
    return { url, pageType, categoryData, pageText }
  }

  // ── Cart / other (minimal) ─────────────────────────────────────────────────
  if (pageType !== 'product') {
    const pageText = extractPageText(1500)
    console.debug(`${TAG} ${pageType} page — skipping product extraction`)
    return { url, pageType, pageText }
  }

  // ── Product page ───────────────────────────────────────────────────────────

  // Layer 1: JSON-LD (fast, no DOM queries)
  const jsonLd = parseJsonLd()
  console.debug(`${TAG} JSON-LD:`, jsonLd ?? 'none found')

  // Layer 2: Semantic HTML / microdata
  const semantic = parseSemanticHtml()
  console.debug(`${TAG} semantic HTML:`, semantic)

  // Layer 3: Wakefit DOM (SELECTORS registry) — batch all reads
  const dom: Partial<ProductData> = {
    name:           scrapeProductName(),
    price:          scrapePrice() || undefined,
    originalPrice:  scrapeOriginalPrice(),
    rating:         scrapeRating(),
    reviewCount:    scrapeReviewCount(),
    highlights:     scrapeHighlights(),
    trialPeriod:    scrapeTrialPeriod(),
    warranty:       scrapeWarranty(),
    specifications: scrapeSpecifications(),
    sizes:          scrapeSizes(),
  }
  console.debug(`${TAG} DOM layer:`, dom)

  const base = merge<ProductData>([jsonLd ?? {}, semantic, dom])
  const product: ProductData = {
    ...base,
    name:           base.name ?? 'Unknown product',
    price:          base.price ?? 0,
    highlights:     (dom.highlights?.length ? dom.highlights : jsonLd?.highlights) ?? [],
    specifications: dom.specifications ?? {},
    sizes:          dom.sizes ?? [],
  }

  const relatedProducts = scrapeRelatedProducts()

  console.debug(`${TAG} final product:`, product)
  console.debug(`${TAG} related products: ${relatedProducts.length}`)

  return { url, pageType, product, relatedProducts, pageText: '' }
}
