/**
 * url-registry-builder.ts
 *
 * Exhaustively crawls category pages to build a complete URL registry.
 * - Visits every category page, scrolls to load all products
 * - Extracts all product URLs from the DOM
 * - Validates URLs with HEAD requests
 * - Derives regex patterns from collected URLs
 */

import type { BrowserContext, Page } from 'playwright'
import type { UrlRegistry, ProductUrl, CategoryUrl, ValidatedPattern, PageTypeKey, NavEdge } from '../shared-types'
import { scrollToRevealContent } from './scroll-trigger'
import { dismissPopups } from './popup-handler'

const TAG = '[url-registry]'

interface RegistryBuildOptions {
  ctx: BrowserContext
  origin: string
  domain: string
  mainNav: NavEdge[]
  log: (msg: string) => void
  maxProductsPerCategory?: number
}

export async function buildUrlRegistry(opts: RegistryBuildOptions): Promise<UrlRegistry> {
  const {
    ctx, origin, domain, mainNav, log,
    maxProductsPerCategory = 200,
  } = opts

  const categories: CategoryUrl[] = []
  const products: ProductUrl[] = []
  const seenProductUrls = new Set<string>()

  // Collect category URLs from nav (limit to top 20 for performance)
  const allCategoryUrls = mainNav
    .filter(n => n.targetPageType === 'category' && n.href)
    .map(n => ({ name: n.label, url: n.href }))

  // Deduplicate by URL
  const seenCatUrls = new Set<string>()
  const categoryUrls = allCategoryUrls.filter(c => {
    if (seenCatUrls.has(c.url)) return false
    seenCatUrls.add(c.url)
    return true
  }).slice(0, 20)

  log(`${TAG} found ${allCategoryUrls.length} category URLs from navigation (crawling top ${categoryUrls.length})`)

  for (const cat of categoryUrls) {
    categories.push(cat)
    log(`${TAG} crawling category: ${cat.name} (${cat.url})`)

    const page = await ctx.newPage()
    try {
      await navigateTo(page, cat.url, log)
      await dismissPopups(page, log)
      await scrollToRevealContent(page, log, { maxSteps: 20, stepDelayMs: 1500 })

      // Extract all product links from the category page
      const rawProducts = await extractProductUrls(page, origin, cat.name, log)

      // Post-process: clean names and filter non-product URLs
      const pageProducts = rawProducts
        .map(p => ({
          ...p,
          name: cleanProductName(p.name),
        }))
        .filter(p => {
          // Filter out non-product URLs
          try {
            const urlPath = new URL(p.url).pathname.toLowerCase()
            if (/\/furniture-store\/|\/business\/|\/bulk-order|\/store\/|\/stores\//i.test(urlPath)) return false
          } catch { return false }
          // Filter out bad names
          if (!p.name || p.name.length < 3) return false
          return true
        })

      let added = 0
      for (const p of pageProducts) {
        if (seenProductUrls.has(p.url)) continue
        if (added >= maxProductsPerCategory) break
        seenProductUrls.add(p.url)
        products.push(p)
        added++
      }

      log(`${TAG}   extracted ${added} new products (${pageProducts.length} total on page)`)

      // Check for pagination / "load more"
      const hasMore = await page.evaluate(() => {
        const loadMore = document.querySelector(
          'button[class*="load-more"], button[class*="loadMore"], ' +
          '[class*="show-more"], [class*="pagination"] a:last-child'
        )
        return !!loadMore
      })

      if (hasMore) {
        log(`${TAG}   pagination detected — clicking through...`)
        await crawlPaginatedProducts(page, origin, cat.name, seenProductUrls, products, log, maxProductsPerCategory)
      }

    } catch (err) {
      log(`${TAG}   error crawling ${cat.url}: ${(err as Error).message}`)
    } finally {
      await page.close()
    }
  }

  // Validate a sample of product URLs
  log(`${TAG} validating product URLs (sampling ${Math.min(20, products.length)})...`)
  const validatedCount = await validateUrls(ctx, products.slice(0, 20), log)
  log(`${TAG} validation: ${validatedCount}/${Math.min(20, products.length)} URLs OK`)

  // Derive URL patterns from collected URLs
  const validatedPatterns = deriveUrlPatterns(products, categories, origin, log)

  log(`${TAG} registry complete: ${products.length} products, ${categories.length} categories, ${validatedPatterns.length} patterns`)

  return { products, categories, validatedPatterns }
}

// ── Product URL extraction ──────────────────────────────────────────────────

async function extractProductUrls(
  page: Page,
  origin: string,
  categoryName: string,
  log: (msg: string) => void,
): Promise<ProductUrl[]> {
  return page.evaluate(
    ({ origin, categoryName }) => {
      const results: Array<{ name: string; url: string; category: string }> = []
      const seen = new Set<string>()

      // Strategy 1: Find product cards and extract their primary links
      const cardSelectors = [
        '[class*="product-card"]',
        '[class*="productCard"]',
        '[class*="product-item"]',
        '[class*="productItem"]',
        '[class*="card-item"]',
        'li[class*="product"]',
        '[class*="collection-item"]',
      ]

      let cards: Element[] = []
      for (const sel of cardSelectors) {
        const found = document.querySelectorAll(sel)
        if (found.length > 2) {
          cards = Array.from(found)
          break
        }
      }

      for (const card of cards) {
        const links = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .filter(a => {
            try {
              const u = new URL(a.href, document.baseURI)
              return u.origin === origin
            } catch { return false }
          })
          .map(a => {
            const u = new URL(a.href, document.baseURI)
            return {
              el: a,
              href: u.origin + u.pathname,
              score: 0,
            }
          })

        // Score links
        for (const link of links) {
          const pathname = new URL(link.href).pathname
          const segments = pathname.split('/').filter(Boolean)

          // Contains image → likely main product link
          if (link.el.querySelector('img')) link.score += 50
          // Contains title element
          if (link.el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]')) link.score += 40
          // Longer path (more specific)
          if (segments.length > 2) link.score += 30
          // SKU pattern at end
          if (/[A-Z0-9]{5,}/.test(segments[segments.length - 1] || '')) link.score += 100
          // Larger clickable area
          if (link.el.offsetWidth > 0 && link.el.offsetHeight > 0) {
            link.score += (link.el.offsetWidth * link.el.offsetHeight) / 1000
          }
          // Penalize action links
          const lower = link.href.toLowerCase()
          if (/quickview|wishlist|compare|share|#/.test(lower)) link.score -= 100
        }

        links.sort((a, b) => b.score - a.score)
        const bestLink = links[0]
        if (!bestLink || seen.has(bestLink.href)) continue
        seen.add(bestLink.href)

        // Extract product name (clean: strip ratings, prices, badges)
        const nameEl = card.querySelector(
          'h2, h3, h4, [class*="title"], [class*="name"], [class*="product-name"], [class*="productName"]'
        )
        let rawName = (nameEl?.textContent ?? '').trim()
        // Remove common noise patterns from product names
        rawName = rawName
          .replace(/[\d.]+\s*\|\s*[\d.]+K?\s*/g, '')   // "4.5| 10.7K"
          .replace(/[₹$€£][\d,]+/g, '')                 // currency amounts
          .replace(/\d+%\s*(off|OFF)/g, '')              // "40% off"
          .replace(/(Top Rated|Best Seller|Newly Launched|Most Popular|New Launch|Smart Workspace)\s*/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
        if (!rawName || rawName.length < 3) continue

        // Filter out non-product URLs (store locator, utility pages)
        const urlPath = new URL(bestLink.href).pathname.toLowerCase()
        if (/\/furniture-store\/|\/business\/|\/bulk-order/i.test(urlPath)) continue

        results.push({ name: rawName, url: bestLink.href, category: categoryName })
      }

      // Strategy 2: If no cards found, scan all links with product-like paths
      if (results.length === 0) {
        const allLinks = document.querySelectorAll<HTMLAnchorElement>('a[href]')
        for (const a of allLinks) {
          try {
            const u = new URL(a.href, document.baseURI)
            if (u.origin !== origin) continue
            const cleanUrl = u.origin + u.pathname
            if (seen.has(cleanUrl)) continue

            const segments = u.pathname.split('/').filter(Boolean)
            if (segments.length < 2) continue
            if (/\/(cart|account|login|checkout|blog|faq|policy)/.test(u.pathname)) continue

            // Only consider links with meaningful text
            const text = (a.textContent ?? '').trim()
            if (!text || text.length > 120 || text.length < 3) continue

            seen.add(cleanUrl)
            results.push({ name: text, url: cleanUrl, category: categoryName })
          } catch { /* skip */ }
        }
      }

      return results
    },
    { origin, categoryName },
  )
}

// ── Pagination crawling ────────────────────────────────────────────────────

async function crawlPaginatedProducts(
  page: Page,
  origin: string,
  categoryName: string,
  seenUrls: Set<string>,
  products: ProductUrl[],
  log: (msg: string) => void,
  maxTotal: number,
): Promise<void> {
  let pages = 0
  const maxPages = 5

  while (pages < maxPages && products.length < maxTotal) {
    // Try clicking "load more" or "next page"
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll(
        'button[class*="load-more"], button[class*="loadMore"], ' +
        '[class*="show-more"] button, [class*="pagination"] a:last-child, ' +
        'button[class*="next"], a[class*="next"]'
      )
      for (const btn of btns) {
        const el = btn as HTMLElement
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          el.click()
          return true
        }
      }
      return false
    })

    if (!clicked) break
    pages++

    await page.waitForTimeout(2000)
    await scrollToRevealContent(page, log, { maxSteps: 5 })

    const pageProducts = await extractProductUrls(page, origin, categoryName, log)
    let added = 0
    for (const p of pageProducts) {
      if (seenUrls.has(p.url)) continue
      seenUrls.add(p.url)
      products.push(p)
      added++
    }
    log(`${TAG}     page ${pages + 1}: ${added} new products`)
    if (added === 0) break
  }
}

// ── URL validation ──────────────────────────────────────────────────────────

async function validateUrls(
  ctx: BrowserContext,
  products: ProductUrl[],
  log: (msg: string) => void,
): Promise<number> {
  let valid = 0
  const page = await ctx.newPage()

  for (const p of products) {
    try {
      const res = await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 10_000 })
      if (res && res.status() < 400) {
        valid++
      } else {
        log(`${TAG}   invalid URL (${res?.status()}): ${p.url}`)
      }
    } catch {
      log(`${TAG}   failed to validate: ${p.url}`)
    }
  }

  await page.close()
  return valid
}

// ── URL pattern derivation ──────────────────────────────────────────────────

function deriveUrlPatterns(
  products: ProductUrl[],
  categories: CategoryUrl[],
  origin: string,
  log: (msg: string) => void,
): ValidatedPattern[] {
  const patterns: ValidatedPattern[] = []

  // Home pattern
  patterns.push({
    pageType: 'home',
    pattern: '^\\/?$',
    examples: [origin],
  })

  // Derive product patterns from actual URLs
  const productPaths = products.map(p => {
    try { return new URL(p.url).pathname } catch { return null }
  }).filter(Boolean) as string[]

  if (productPaths.length > 0) {
    const productPatterns = clusterPaths(productPaths)
    for (const pp of productPatterns) {
      patterns.push({
        pageType: 'product',
        pattern: pp.pattern,
        examples: pp.examples.slice(0, 3),
      })
    }
    log(`${TAG} derived ${productPatterns.length} product URL patterns from ${productPaths.length} URLs`)
  }

  // Derive category patterns
  // Categories are typically single-segment paths like /mattress, /bed, /sofa-set
  // Since each is unique, clusterPaths won't group them. Instead, build an
  // alternation of exact category slugs OR a simple generic pattern.
  const catPaths = categories.map(c => {
    try { return new URL(c.url).pathname } catch { return null }
  }).filter(Boolean) as string[]

  if (catPaths.length > 0) {
    // For categories, since they're single-segment, create a simple alternation
    const singleSegCats = catPaths.filter(p => p.split('/').filter(Boolean).length === 1)

    if (singleSegCats.length >= 3) {
      // Build alternation of known category slugs
      const slugs = singleSegCats
        .map(p => p.split('/').filter(Boolean)[0])
        .filter(Boolean)
        .map(escapeRegex)

      patterns.push({
        pageType: 'category',
        pattern: `^\\/(${slugs.join('|')})\\/?$`,
        examples: singleSegCats.slice(0, 5),
      })
    }

    // Also add any multi-segment category patterns via clustering
    const multiSegCats = catPaths.filter(p => p.split('/').filter(Boolean).length > 1)
    const catPatterns = clusterPaths(multiSegCats)
    for (const cp of catPatterns) {
      patterns.push({
        pageType: 'category',
        pattern: cp.pattern,
        examples: cp.examples.slice(0, 3),
      })
    }
  }

  // Cart pattern
  patterns.push({
    pageType: 'cart',
    pattern: '^\\/cart\\/?',
    examples: [`${origin}/cart`],
  })

  // Search pattern
  patterns.push({
    pageType: 'search',
    pattern: '^\\/search',
    examples: [`${origin}/search-result`],
  })

  return patterns
}

interface PathCluster {
  pattern: string
  examples: string[]
}

/**
 * Cluster URL paths into regex patterns.
 * E.g., /mattress/product-name/SKU → \/mattress\/[^/]+\/[A-Z0-9]+
 *
 * Groups by path depth and first segment. Produces GENERIC patterns
 * (using [^/]+) when a segment varies across URLs.
 * Only emits patterns with 2+ members to avoid overly-specific patterns.
 */
function clusterPaths(paths: string[]): PathCluster[] {
  // Group by path depth and prefix
  const groups = new Map<string, string[]>()

  for (const path of paths) {
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) continue

    // Create a signature: depth + first segment
    const sig = `${segments.length}:${segments[0]}`
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig)!.push(path)
  }

  const clusters: PathCluster[] = []

  for (const [sig, memberPaths] of groups) {
    // Require at least 2 members for a pattern to be meaningful
    // (single URLs → too specific to be a useful pattern)
    if (memberPaths.length < 2) continue

    const [depthStr] = sig.split(':')
    const depth = parseInt(depthStr, 10)

    // Build pattern by analyzing each segment position
    const patternParts: string[] = []
    for (let i = 0; i < depth; i++) {
      const segValues = memberPaths.map(p => p.split('/').filter(Boolean)[i]).filter(Boolean)
      const unique = new Set(segValues)

      if (unique.size === 1) {
        // All same → literal
        patternParts.push(escapeRegex(segValues[0]))
      } else if (segValues.every(s => /^[A-Z0-9]{4,}$/.test(s))) {
        // All look like SKUs
        patternParts.push('[A-Z0-9]{4,}')
      } else {
        // Variable segment
        patternParts.push('[^/]+')
      }
    }

    const pattern = '\\/' + patternParts.join('\\/')
    clusters.push({
      pattern,
      examples: memberPaths.slice(0, 5),
    })
  }

  // If no clusters with 2+ members, allow singleton patterns but only
  // if they have a clear product URL structure (category/slug/SKU)
  if (clusters.length === 0 && paths.length > 0) {
    // Still group singletons but generalize more
    const genericPatterns = new Set<string>()
    for (const path of paths) {
      const segments = path.split('/').filter(Boolean)
      if (segments.length >= 2) {
        // Just use depth and first segment
        const pat = '\\/' + escapeRegex(segments[0]) + segments.slice(1).map(() => '\\/[^/]+').join('')
        genericPatterns.add(pat)
      }
    }
    for (const pat of genericPatterns) {
      clusters.push({
        pattern: pat,
        examples: paths.filter(p => {
          const segs = p.split('/').filter(Boolean)
          return segs[0] === pat.match(/\\\/([^\\]+)/)?.[1]
        }).slice(0, 3),
      })
    }
  }

  return clusters
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Clean noise from product names extracted from the DOM.
 * Strips ratings, prices, badge text, pipe characters, etc.
 *
 * Common patterns to strip:
 *   "4.5| 10.7K"  → rating block
 *   "₹1,399₹2,33240% off" → price block with discount
 *   "Top Rated", "Best Seller" → badge text
 *   Trailing "|" → pipe from tab/section separators
 */
function cleanProductName(raw: string): string {
  let name = raw

  // Strip badge/label prefixes
  name = name.replace(/(Top Rated|Best Seller|Newly Launched|Most Popular|New Launch|Smart Workspace|Trending|Limited Edition|Exclusive)\s*/gi, '')

  // Strip rating blocks: "4.5| 10.7K", "0 "
  name = name.replace(/[\d.]+\s*\|\s*[\d.,]+K?\s*/g, '')

  // Strip everything from the first currency symbol onward
  // (prices always come after the product name in DOM text)
  const currencyIdx = name.search(/[₹$€£]/)
  if (currencyIdx > 5) {
    // Only strip if we have at least 5 chars of name before the currency
    name = name.slice(0, currencyIdx)
  }

  // If currency stripping didn't help, try regex-based cleanup
  name = name
    .replace(/[₹$€£]\s*[\d,]+(\.\d+)?/g, '')    // currency amounts
    .replace(/\d+%\s*(off|OFF|Off)/gi, '')        // discount percentages
    .replace(/\d+%/g, '')                         // standalone percentages

  // Strip concatenated variant text: "KingSingleQueen", "SeaterBlackDark Grey"
  // Only strip when these words run together without spaces (UI glitch)
  name = name.replace(/(?:King|Single|Queen|Double){2,}/g, '')
  name = name.replace(/Seater[A-Z][a-z]+(?:[A-Z][a-z]+)*/g, 'Seater')

  // Strip pipe at start and end
  name = name.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '')

  // Strip leading zero review count: "0 Product Name" (but not "200 TC...")
  name = name.replace(/^0\s+(?=[A-Z])/, '')

  // Clean whitespace
  name = name.replace(/\s+/g, ' ').trim()

  return name.slice(0, 120)
}

// ── Navigation helper ──────────────────────────────────────────────────────

async function navigateTo(page: Page, url: string, log: (msg: string) => void): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

      // Check for Cloudflare challenge
      const isCf = await page.evaluate(() => {
        const title = document.title.toLowerCase()
        return title.includes('just a moment') ||
               title.includes('security check') ||
               !!document.querySelector('#challenge-running, #cf-challenge-running')
      })

      if (isCf) {
        log(`${TAG} Cloudflare challenge on ${url} — waiting...`)
        try {
          await page.waitForFunction(
            () => !document.title.toLowerCase().includes('just a moment'),
            { timeout: 15_000 },
          )
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
        } catch {
          if (attempt < 3) {
            await page.waitForTimeout(3_000 * attempt)
            continue
          }
        }
      }

      return
    } catch (err) {
      if (attempt === 3) {
        log(`${TAG} navigate failed: ${url} — ${(err as Error).message}`)
      } else {
        await page.waitForTimeout(2_000 * attempt)
      }
    }
  }
}
