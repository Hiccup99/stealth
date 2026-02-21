/**
 * sitemap-discoverer.ts
 *
 * Discovers representative page URLs by:
 *  1. Fetching /sitemap.xml (and any linked child sitemaps)
 *  2. Parsing all <loc> entries
 *  3. Clustering URLs into page-type buckets by URL pattern
 *  4. Selecting N diverse samples from each bucket
 *
 * Falls back to crawling the nav links when sitemap is unavailable.
 */

import type { PageTypeKey } from '../shared-types'

const TAG = '[sitemap-discoverer]'

export interface UrlBucket {
  type: PageTypeKey
  urls: string[]
}

export interface DiscoveredUrls {
  buckets: UrlBucket[]
  /** N samples per page type, ready for extraction */
  samples: Partial<Record<PageTypeKey, string[]>>
}

const SAMPLES_PER_TYPE = 3

// ── XML Parsing helpers ───────────────────────────────────────────────────────

/** Extract <loc> values from a sitemap XML string */
function extractLocs(xml: string): string[] {
  const locs: string[] = []
  const re = /<loc>(.*?)<\/loc>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1].trim())
  }
  return locs
}

/** Extract <sitemap><loc> (child sitemap index) entries */
function extractChildSitemaps(xml: string): string[] {
  const urls: string[] = []
  const re = /<sitemap>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    urls.push(m[1].trim())
  }
  return urls
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; CopilotCrawler/2.0; +https://copilot.dev/bot)',
        'Accept': 'text/xml,application/xml,text/plain',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ── URL classifier ────────────────────────────────────────────────────────────

/**
 * Score a URL for each e-commerce page type.
 * Returns the type with the highest score, or 'other'.
 *
 * Deliberately generic — no vertical-specific keywords.
 */
function classifyUrl(url: string): PageTypeKey {
  try {
    const { pathname } = new URL(url)
    const parts = pathname.split('/').filter(Boolean)
    const lower = pathname.toLowerCase()

    // Cart
    if (lower.includes('cart') || lower.includes('basket') || lower.includes('bag')) return 'cart'

    // Search results
    if (lower.includes('search') || lower.includes('q=') || lower.includes('query=')) return 'search'

    // Home
    if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) return 'home'

    // Auth / utility — skip
    if (/\/(login|register|account|checkout|order|wishlist|contact|about|blog|faq|policy|terms|privacy)/i.test(lower)) {
      return 'other'
    }

    // Product: deep URLs with slug-like last segment containing digits or long compound words
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]
      // Has product-code-like pattern: letters-numbers or long slug
      if (/[A-Z0-9]{4,}/.test(last) || /^[a-z0-9-]{15,}$/.test(last)) return 'product'
      if (parts.length >= 3) return 'product'
    }

    // Category: single-segment clean slug, or two short segments
    if (parts.length === 1) return 'category'
    if (parts.length === 2) {
      const [, last] = parts
      if (/^[a-z0-9-]{3,30}$/.test(last)) return 'category'
    }

    return 'other'
  } catch {
    return 'other'
  }
}

// ── Cluster + sample ──────────────────────────────────────────────────────────

function clusterUrls(urls: string[], domain: string): Partial<Record<PageTypeKey, string[]>> {
  const buckets: Partial<Record<PageTypeKey, string[]>> = {}

  for (const url of urls) {
    try {
      const { hostname } = new URL(url)
      // Only include same-domain URLs
      if (!hostname.includes(domain)) continue
      const type = classifyUrl(url)
      if (type === 'other') continue
      if (!buckets[type]) buckets[type] = []
      buckets[type]!.push(url)
    } catch {
      // skip invalid URLs
    }
  }
  return buckets
}

/**
 * Pick N diverse samples from a URL bucket.
 * "Diverse" means spread across different first path segments (sub-categories).
 */
function pickSamples(urls: string[], n: number): string[] {
  if (urls.length <= n) return urls

  // Group by first path segment to get sub-category diversity
  const groups = new Map<string, string[]>()
  for (const url of urls) {
    try {
      const { pathname } = new URL(url)
      const key = pathname.split('/').filter(Boolean)[0] ?? '_root'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(url)
    } catch {
      // skip
    }
  }

  const picked: string[] = []
  const groupArrays = [...groups.values()]

  // Round-robin across groups
  let i = 0
  while (picked.length < n && i < 100) {
    const group = groupArrays[i % groupArrays.length]
    if (group && group.length > 0) {
      picked.push(group.shift()!)
    }
    i++
    if (groupArrays.every(g => g.length === 0)) break
  }

  return picked
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DiscoveryOptions {
  origin: string
  domain: string
  /** Extra seed URLs from nav links (fallback when sitemap is empty) */
  seedUrls?: string[]
  log: (msg: string) => void
}

export async function discoverUrls(opts: DiscoveryOptions): Promise<DiscoveredUrls> {
  const { origin, domain, seedUrls = [], log } = opts
  const allUrls = new Set<string>()

  // ── Attempt sitemap.xml ───────────────────────────────────────────────────

  const sitemapRoots = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/sitemaps.xml`,
  ]

  let sitemapFetched = false

  for (const sitemapUrl of sitemapRoots) {
    log(`${TAG} fetching sitemap: ${sitemapUrl}`)
    const xml = await fetchText(sitemapUrl)
    if (!xml) continue

    sitemapFetched = true

    // Is this a sitemap index?
    const childSitemaps = extractChildSitemaps(xml)
    if (childSitemaps.length > 0) {
      log(`${TAG}   found sitemap index with ${childSitemaps.length} child sitemaps`)
      // Fetch child sitemaps in parallel (limit concurrency)
      const batch = childSitemaps.slice(0, 10) // cap at 10 child sitemaps
      await Promise.all(
        batch.map(async (childUrl) => {
          const childXml = await fetchText(childUrl)
          if (!childXml) return
          const locs = extractLocs(childXml)
          locs.forEach(u => allUrls.add(u))
          log(`${TAG}   child sitemap ${childUrl}: ${locs.length} URLs`)
        })
      )
    } else {
      // Direct sitemap
      const locs = extractLocs(xml)
      locs.forEach(u => allUrls.add(u))
      log(`${TAG}   direct sitemap: ${locs.length} URLs`)
    }

    break // found a working sitemap
  }

  if (!sitemapFetched) {
    log(`${TAG} no sitemap found — falling back to seed URLs from nav`)
  }

  // ── Add seed URLs from nav links ──────────────────────────────────────────

  seedUrls.forEach(u => allUrls.add(u))
  log(`${TAG} total URLs before clustering: ${allUrls.size}`)

  // ── Cluster + sample ──────────────────────────────────────────────────────

  const buckets = clusterUrls([...allUrls], domain)

  const samples: Partial<Record<PageTypeKey, string[]>> = {}
  for (const [type, urls] of Object.entries(buckets) as [PageTypeKey, string[]][]) {
    samples[type] = pickSamples(urls, SAMPLES_PER_TYPE)
    log(`${TAG} [${type}] ${urls.length} URLs → ${samples[type]!.length} samples: ${samples[type]!.map(u => new URL(u).pathname).join(', ')}`)
  }

  const bucketsList: UrlBucket[] = Object.entries(buckets).map(([type, urls]) => ({
    type: type as PageTypeKey,
    urls: urls as string[],
  }))

  return { buckets: bucketsList, samples }
}
