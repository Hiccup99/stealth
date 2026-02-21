/**
 * crawl-engine.ts — v3
 *
 * Screenshot-led 5-phase ingestion pipeline.
 *
 * Phase 1 — Visual Reconnaissance
 *   - Fetch sitemap.xml + nav links to discover URLs
 *   - Take screenshots and use Gemini Flash Vision to classify pages
 *   - Build sample URL buckets per page type
 *
 * Phase 2 — URL Registry
 *   - Visit every category page, scroll fully
 *   - Extract ALL product URLs from DOM
 *   - Validate URLs, derive regex patterns
 *
 * Phase 3 — Feature Detection
 *   - Screenshot each page type
 *   - VLM identifies interactive elements (filters, sort, variants, CTAs)
 *   - Cross-reference with DOM to find selectors
 *
 * Phase 4 — Interaction Recipes
 *   - For each feature, determine how to operate it
 *   - Generate step-by-step recipes
 *   - Validate recipes against live site
 *
 * Phase 5 — Assembly
 *   - Merge all outputs into enhanced SiteConfig v3
 *   - Includes urlRegistry, features, interactionRecipes
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type {
  SiteConfig, PageTypeKey, NavEdge, SelectorEntry,
  UrlRegistry, Feature, InteractionRecipe,
} from '../shared-types'
import { classifyPage }            from './page-classifier'
import { discoverUrls }            from './sitemap-discoverer'
import { dismissPopups }           from './popup-handler'
import { scrollToRevealContent }   from './scroll-trigger'
import { verifySelector }          from './content-verifier'
import { scoreConsensus, calculateCoverage } from './consensus-scorer'
import { ECOMMERCE_TAXONOMY, TAXONOMY_GROUPS } from './ecommerce-taxonomy'
import type { PageProbeResults }   from './consensus-scorer'
import { updateJob, saveSiteConfig } from '../store/job-store'
import { classifyPageVisually }    from './visual-analyzer'
import { buildUrlRegistry }        from './url-registry-builder'
import { extractFeatures }         from './feature-extractor'
import { buildRecipes }            from './recipe-builder'

const TAG = '[crawl-engine]'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrawlContext {
  jobId: string
  rootUrl: string
  origin: string
  domain: string
  browser: Browser
  ctx: BrowserContext
  apiKey: string | null
  logs: string[]
  log: (msg: string) => void
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function crawlWebsite(
  jobId: string,
  rootUrl: string,
  geminiApiKey?: string,
): Promise<void> {
  const logs: string[] = []
  const log = (msg: string) => {
    logs.push(msg)
    console.log(msg)
    updateJob(jobId, { logs: [...logs] }).catch(() => {})
  }

  const startMs = Date.now()
  const url      = new URL(rootUrl)
  const origin   = url.origin
  const domain   = url.hostname.replace(/^www\./, '')

  log(`${TAG} ═══ CRAWL v3 START: ${rootUrl} ═══`)
  log(`${TAG} VLM mode: ${geminiApiKey ? 'Gemini Flash Vision' : 'DOM-only (no API key)'}`)
  await updateJob(jobId, { status: 'running', logs })

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Anti-detection flags
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1440,900',
      ],
    })

    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      // Stealth overrides
      javaScriptEnabled: true,
    })

    // Remove webdriver detection
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      // @ts-ignore
      delete navigator.__proto__.webdriver
      // Fake plugins (headless has none)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      })
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en', 'hi'],
      })
      // Chrome runtime fake
      // @ts-ignore
      window.chrome = { runtime: {} }
    })

    const cc: CrawlContext = {
      jobId, rootUrl, origin, domain, browser, ctx,
      apiKey: geminiApiKey ?? null,
      logs, log,
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 1: Visual Reconnaissance
    // ══════════════════════════════════════════════════════════════════════════
    log(`${TAG} ── Phase 1: Visual Reconnaissance ──`)
    const { mainNav, sampleUrls, visualClassifications } = await phase1Reconnaissance(cc)

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 2: URL Registry
    // ══════════════════════════════════════════════════════════════════════════
    log(`${TAG} ── Phase 2: URL Registry ──`)

    // If nav found few categories, supplement by discovering category URLs
    // from ALL links on the home page
    const enrichedNav = await supplementNavWithHomePageLinks(cc, mainNav)
    if (enrichedNav.length > mainNav.length) {
      log(`${TAG} supplemented nav: ${mainNav.length} → ${enrichedNav.length} links`)
    }

    const urlRegistry = await buildUrlRegistry({
      ctx, origin, domain, mainNav: enrichedNav, log,
    })
    log(`${TAG} URL registry: ${urlRegistry.products.length} products, ${urlRegistry.categories.length} categories`)

    // Enrich sample URLs with product URLs from the registry
    // (so DOM probing visits actual product pages)
    if (urlRegistry.products.length > 0) {
      const productSampleUrls = pickDiverseProducts(urlRegistry.products, 3)
      if (!sampleUrls.product || sampleUrls.product.length === 0) {
        sampleUrls.product = productSampleUrls
        log(`${TAG} injected ${productSampleUrls.length} product URLs into sample buckets`)
      }
    }

    // Also ensure we have good category samples from the URL registry
    if (urlRegistry.categories.length > 0 && (!sampleUrls.category || sampleUrls.category.length < 2)) {
      sampleUrls.category = urlRegistry.categories
        .filter(c => !c.url.match(/store|dealer|bulk/i))
        .map(c => c.url)
        .slice(0, 3)
      if (sampleUrls.category.length > 0) {
        log(`${TAG} replaced category samples with ${sampleUrls.category.length} URLs from registry`)
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 3: Feature Detection (VLM + DOM)
    // ══════════════════════════════════════════════════════════════════════════
    log(`${TAG} ── Phase 3: Feature Detection ──`)
    let features: Partial<Record<PageTypeKey, Feature[]>> = {}
    let urlInteractionPatterns: Record<string, any> = {}

    if (cc.apiKey) {
      const featureResult = await extractFeatures({
        ctx, apiKey: cc.apiKey, sampleUrls, log,
      })
      features = featureResult.features
      urlInteractionPatterns = featureResult.urlInteractionPatterns
    } else {
      log(`${TAG} skipping VLM feature detection (no Gemini API key)`)
      // Fall back to DOM-only element probing
      const { elements: domElements } =
        await phase2DomExtract(cc, sampleUrls)
      // Convert probed elements to basic features
      features = convertElementsToFeatures(domElements)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 4: Interaction Recipes
    // ══════════════════════════════════════════════════════════════════════════
    log(`${TAG} ── Phase 4: Interaction Recipes ──`)
    const { recipes, features: enrichedFeatures } = await buildRecipes({
      ctx, origin, features, urlInteractionPatterns, sampleUrls, log,
    })

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 5: Assembly (DOM element probing still runs for backward compat)
    // ══════════════════════════════════════════════════════════════════════════
    log(`${TAG} ── Phase 5: Assembly ──`)

    // Run legacy DOM probing for elements map (backward compat with extension)
    const { elements, pageTypeRules, pageTypeSampleCounts } =
      await phase2DomExtract(cc, sampleUrls)

    const coverage = calculateCoverage(elements)
    log(`${TAG} Element coverage: ${coverage.overallPct}%`)

    // Use URL registry patterns for page type rules (higher quality than DOM-derived)
    const mergedPageTypes = mergePageTypeRules(pageTypeRules, urlRegistry, visualClassifications)

    const durationMs = Date.now() - startMs
    const totalSamples = Object.values(pageTypeSampleCounts).reduce((a, b) => a + b, 0)

    const config: SiteConfig = {
      domain,
      version: '3.0.0',
      crawledAt: new Date().toISOString(),
      crawlStats: {
        pagesVisited: totalSamples,
        productSamples: pageTypeSampleCounts['product'] ?? 0,
        categorySamples: pageTypeSampleCounts['category'] ?? 0,
        durationMs,
      },
      pageTypes: mergedPageTypes,
      elements,
      navigationGraph: buildNavGraph(mainNav),
      productSchema: buildProductSchema(elements),
      listingSchema: buildListingSchema(elements),
      mainNav,
      coverage,
      urlRegistry,
      features: enrichedFeatures,
      interactionRecipes: recipes,
      meta: {
        brandName: deriveBrandName(domain),
        currency: 'INR',
        locale: 'en-IN',
        primaryCategories: mainNav
          .filter(n => n.targetPageType === 'category')
          .map(n => n.label)
          .slice(0, 12),
        platform: detectPlatform(logs),
      },
    }

    await saveSiteConfig(config)
    await updateJob(jobId, {
      status: 'done',
      completedAt: new Date().toISOString(),
      logs,
    })

    log(`${TAG} ═══ CRAWL v3 DONE in ${(durationMs / 1000).toFixed(1)}s ═══`)
    log(`${TAG}   Elements mapped:      ${Object.keys(elements).length}`)
    log(`${TAG}   Coverage:             ${coverage.overallPct}%`)
    log(`${TAG}   Products registered:  ${urlRegistry.products.length}`)
    log(`${TAG}   Features detected:    ${Object.values(enrichedFeatures).flat().length}`)
    log(`${TAG}   Recipes generated:    ${Object.keys(recipes).length}`)
    log(`${TAG}   Pages visited:        ${totalSamples}`)

  } catch (err) {
    const msg = (err as Error).message
    log(`${TAG} ✖ CRAWL FAILED: ${msg}`)
    await updateJob(jobId, {
      status: 'failed',
      error: msg,
      completedAt: new Date().toISOString(),
      logs,
    }).catch(() => {})
    throw err
  } finally {
    if (browser) await browser.close()
  }
}

// ── Phase 1: Visual Reconnaissance ──────────────────────────────────────────

interface VisualClassification {
  url: string
  pageType: PageTypeKey
  confidence: number
  method: 'vlm' | 'url' | 'dom'
}

async function phase1Reconnaissance(cc: CrawlContext): Promise<{
  mainNav: NavEdge[]
  sampleUrls: Partial<Record<PageTypeKey, string[]>>
  visualClassifications: VisualClassification[]
}> {
  const { ctx, origin, domain, log, apiKey } = cc

  const homePage = await ctx.newPage()
  await navigateTo(homePage, cc.rootUrl, log)
  await dismissPopups(homePage, log)
  // Give SPA frameworks time to render nav
  await homePage.waitForTimeout(3000)

  // Extract main nav links
  const mainNav = await extractMainNav(homePage, domain, log)
  log(`${TAG} main nav: ${mainNav.length} links`)

  // Visual classification of home page
  const visualClassifications: VisualClassification[] = []
  if (apiKey) {
    try {
      const homeAnalysis = await classifyPageVisually(homePage, apiKey, log)
      visualClassifications.push({
        url: cc.rootUrl,
        pageType: homeAnalysis.pageType,
        confidence: homeAnalysis.confidence,
        method: 'vlm',
      })
    } catch (err) {
      log(`${TAG} VLM classification failed for home: ${(err as Error).message}`)
    }
  }

  // Discover URLs via sitemap + nav seeds
  const seedUrls = mainNav.map(n => n.href)
  const discovered = await discoverUrls({ origin, domain, seedUrls, log })

  await homePage.close()

  // Ensure home is included
  if (!discovered.samples.home) {
    discovered.samples.home = [cc.rootUrl]
  }

  // Visually classify a sample from each discovered bucket
  if (apiKey) {
    for (const [pageType, urls] of Object.entries(discovered.samples) as [PageTypeKey, string[]][]) {
      if (pageType === 'home' || !urls || urls.length === 0) continue
      const page = await ctx.newPage()
      try {
        await navigateTo(page, urls[0], log)
        const analysis = await classifyPageVisually(page, apiKey, log)
        visualClassifications.push({
          url: urls[0],
          pageType: analysis.pageType,
          confidence: analysis.confidence,
          method: 'vlm',
        })

        // If VLM disagrees with URL-based classification, reclassify
        if (analysis.pageType !== pageType && analysis.confidence > 80) {
          log(`${TAG} VLM reclassified ${urls[0]} from ${pageType} to ${analysis.pageType}`)
          // Move URL to correct bucket
          if (!discovered.samples[analysis.pageType]) {
            discovered.samples[analysis.pageType] = []
          }
          discovered.samples[analysis.pageType]!.push(urls[0])
          discovered.samples[pageType] = urls.filter(u => u !== urls[0])
        }
      } catch (err) {
        log(`${TAG} VLM classification error: ${(err as Error).message}`)
      } finally {
        await page.close()
      }
    }
  }

  log(`${TAG} sample URLs per type: ${
    Object.entries(discovered.samples)
      .map(([k, v]) => `${k}:${(v as string[]).length}`)
      .join(', ')
  }`)

  return { mainNav, sampleUrls: discovered.samples, visualClassifications }
}

// ── Phase 2 (legacy): DOM element probing ──────────────────────────────────

async function phase2DomExtract(
  cc: CrawlContext,
  sampleUrls: Partial<Record<PageTypeKey, string[]>>,
): Promise<{
  elements: Record<string, SelectorEntry>
  pageTypeRules: Partial<Record<PageTypeKey, import('../shared-types').PageTypeRule>>
  pageTypeSampleCounts: Partial<Record<PageTypeKey, number>>
}> {
  const { ctx, log } = cc
  const pageTypeRules: Partial<Record<PageTypeKey, import('../shared-types').PageTypeRule>> = {}
  const allPageResults: PageProbeResults[] = []
  const pageTypeSampleCounts: Partial<Record<PageTypeKey, number>> = {}

  const typeOrder: PageTypeKey[] = ['home', 'category', 'product', 'cart', 'search', 'other']

  for (const pageType of typeOrder) {
    const urls = sampleUrls[pageType]
    if (!urls || urls.length === 0) continue

    log(`${TAG} [dom-probe][${pageType}] ${urls.length} sample(s)`)
    pageTypeSampleCounts[pageType] = urls.length

    const relevantIntents = getIntentsForPageType(pageType)

    for (const [idx, url] of urls.entries()) {
      log(`${TAG} [dom-probe][${pageType}][${idx + 1}/${urls.length}] ${url}`)
      const page = await ctx.newPage()

      try {
        await navigateTo(page, url, log)
        await dismissPopups(page, log)
        await scrollToRevealContent(page, log, { maxSteps: 10 })

        const classification = await classifyPage(page, url, log)
        if (!pageTypeRules[classification.type]) {
          pageTypeRules[classification.type] = classification.rule
        }

        const pageResult: PageProbeResults = {}

        for (const intent of relevantIntents) {
          const entry = ECOMMERCE_TAXONOMY[intent]
          if (!entry) continue

          const probes: import('./consensus-scorer').ProbeResult[] = []

          for (const candidate of entry.candidates) {
            let matched = false
            let verified = false
            let exampleValue: string | undefined

            try {
              const count = await page.locator(candidate).count()
              matched = count > 0
              if (matched) {
                const verifyResult = await verifySelector(page, candidate, entry.verifyAs)
                verified = verifyResult.valid
                exampleValue = verifyResult.exampleValue
              }
            } catch {
              // bad selector
            }

            probes.push({ selector: candidate, matched, verified, exampleValue })
          }

          if (probes.some(p => p.matched)) {
            pageResult[intent] = probes
          }
        }

        allPageResults.push(pageResult)
        log(`${TAG}   matched ${Object.keys(pageResult).length}/${relevantIntents.length} intents`)

      } catch (err) {
        log(`${TAG}   error: ${(err as Error).message}`)
      } finally {
        await page.close()
      }
    }
  }

  const elements = scoreConsensus(
    allPageResults,
    Object.fromEntries(Object.entries(ECOMMERCE_TAXONOMY).map(([k, v]) => [k, v.verifyAs])),
  )

  return { elements, pageTypeRules, pageTypeSampleCounts }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function navigateTo(page: Page, url: string, log: (m: string) => void): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

      // Check for Cloudflare challenge
      const isCf = await page.evaluate(() => {
        const title = document.title.toLowerCase()
        return title.includes('just a moment') ||
               title.includes('security check') ||
               !!document.querySelector('#challenge-running, #cf-challenge-running, .cf-turnstile')
      })

      if (isCf) {
        log(`${TAG} Cloudflare challenge detected on ${url} — waiting up to 15s...`)
        try {
          // Wait for the challenge to auto-resolve
          await page.waitForFunction(
            () => !document.title.toLowerCase().includes('just a moment') &&
                  !document.querySelector('#challenge-running'),
            { timeout: 15_000 },
          )
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
          log(`${TAG} Cloudflare challenge resolved`)
        } catch {
          log(`${TAG} Cloudflare challenge did not resolve — attempt ${attempt}/3`)
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

function getIntentsForPageType(pageType: PageTypeKey): string[] {
  const global   = TAXONOMY_GROUPS.global
  const specific: string[] = (() => {
    switch (pageType) {
      case 'product':  return TAXONOMY_GROUPS.pdp
      case 'category':
      case 'search':   return TAXONOMY_GROUPS.plp
      case 'cart':     return TAXONOMY_GROUPS.cart
      default:         return []
    }
  })()
  return [...new Set([...global, ...specific])]
}

async function extractMainNav(page: Page, domain: string, log: (m: string) => void): Promise<NavEdge[]> {
  try {
    // Step 1: Try hovering over top-level nav items to reveal mega-menus/dropdowns
    await revealHiddenMenus(page, log)

    const edges = await page.evaluate(
      ({ domain }) => {
        // Very broad selector set to catch all navigational links
        const selectors = [
          'header a[href]',
          'nav a[href]',
          '[role="navigation"] a[href]',
          '[class*="nav"] a[href]',
          '[class*="Nav"] a[href]',
          '[class*="menu"] a[href]',
          '[class*="Menu"] a[href]',
          '[class*="mega"] a[href]',
          '[class*="dropdown"] a[href]',
          '[class*="submenu"] a[href]',
          '[class*="sub-menu"] a[href]',
          '[class*="header"] a[href]',
          '[class*="Header"] a[href]',
          '[class*="topbar"] a[href]',
          '[class*="top-bar"] a[href]',
        ]

        const allAnchors = new Set<HTMLAnchorElement>()
        for (const sel of selectors) {
          document.querySelectorAll<HTMLAnchorElement>(sel).forEach(a => allAnchors.add(a))
        }

        // Also check the top 150px of the page for any links (covers sticky navs)
        document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
          const rect = a.getBoundingClientRect()
          if (rect.top >= 0 && rect.top < 150) allAnchors.add(a)
        })

        const seen = new Map<string, { label: string; href: string }>()

        // Utility/skip patterns
        const skipRe = /\/(login|register|account|signup|sign-up|cart|checkout|blog|faq|contact|about|policy|terms|privacy|careers|press|investor|media|customer-service|help|support|order|track|wishlist|gift|gift-card)/i
        const storeRe = /\/(?:store|stores|furniture-store|dealer|franchise|become-dealer|bulk-orders?|business|referral|refer)\b/i

        for (const anchor of allAnchors) {
          try {
            const url = new URL(anchor.href)
            if (!url.hostname.includes(domain)) continue

            const cleanHref = url.origin + url.pathname
            // Don't re-add if we already have a shorter label for this URL
            if (seen.has(cleanHref)) {
              const existing = seen.get(cleanHref)!
              const newLabel = (anchor.textContent ?? '').trim().replace(/\s+/g, ' ')
              if (newLabel && newLabel.length < existing.label.length) {
                existing.label = newLabel
              }
              continue
            }

            // Get text from the anchor itself (not nested content)
            let label = (anchor.textContent ?? '').trim().replace(/\s+/g, ' ')
            if (!label || label.length > 80 || label.length < 2) continue

            const lower = url.pathname.toLowerCase()

            // Skip utility/auth/support pages
            if (skipRe.test(lower)) continue

            // Skip fragment-only links
            if (url.pathname === '/' && url.hash) continue

            // Skip the homepage itself
            if (url.pathname === '/' || url.pathname === '') continue

            seen.set(cleanHref, { label, href: cleanHref })
          } catch { /* skip */ }
        }

        const results = [...seen.values()]

        // Sort: shorter paths first (more likely to be top-level categories)
        results.sort((a, b) => {
          const aDepth = new URL(a.href).pathname.split('/').filter(Boolean).length
          const bDepth = new URL(b.href).pathname.split('/').filter(Boolean).length
          return aDepth - bDepth
        })

        return results.slice(0, 50)
      },
      { domain },
    )

    // Step 2: Classify each link as category vs product
    const classifiedEdges = edges.map(({ label, href }) => {
      const path   = new URL(href).pathname
      const parts  = path.split('/').filter(Boolean)
      const lower  = path.toLowerCase()

      // Heuristic classification
      let targetPageType: PageTypeKey = 'category' // default for nav links

      // Skip-style links that aren't product categories
      const storeRe = /\/(?:store|stores|furniture-store|dealer|franchise|become-dealer|bulk-orders?|business|referral|refer)\b/i
      if (storeRe.test(lower)) {
        targetPageType = 'other'
      }
      // If it has 3+ segments or ends with a SKU-like pattern, it's a product
      else if (parts.length >= 3) {
        targetPageType = 'product'
      } else if (parts.length === 2) {
        const lastSeg = parts[parts.length - 1]
        // If last segment looks like a product slug with SKU
        if (/[A-Z0-9]{5,}/.test(lastSeg)) {
          targetPageType = 'product'
        }
        // Long specific slug likely a product
        else if (/^[a-z0-9-]{20,}$/.test(lastSeg)) {
          targetPageType = 'product'
        }
      }

      return { label, href, targetPageType }
    })

    // Filter out 'other' type links but keep the useful ones
    const useful = classifiedEdges.filter(e => e.targetPageType !== 'other')
    log(`${TAG} nav extraction: ${edges.length} raw → ${useful.length} useful (${classifiedEdges.filter(e => e.targetPageType === 'other').length} skipped as utility)`)

    return useful
  } catch (err) {
    log(`${TAG} extractMainNav failed: ${(err as Error).message}`)
    return []
  }
}

/**
 * Try to reveal hidden mega-menus by hovering over top-level nav items.
 */
async function revealHiddenMenus(page: Page, log: (m: string) => void): Promise<void> {
  try {
    const topNavItems = await page.locator(
      'header nav > ul > li, header nav > div > a, ' +
      '[class*="nav"] > ul > li, [class*="menu"] > ul > li, ' +
      '[role="navigation"] > ul > li'
    ).all()

    if (topNavItems.length === 0) {
      // Try clicking a hamburger/menu button
      const hamburger = page.locator(
        'button[aria-label*="menu" i], button[class*="hamburger"], ' +
        'button[class*="menu-toggle"], button[class*="nav-toggle"], ' +
        '[class*="burger"], [class*="mobile-menu"] button'
      ).first()

      if (await hamburger.count() > 0) {
        log(`${TAG} clicking hamburger menu to reveal navigation...`)
        await hamburger.click().catch(() => {})
        await page.waitForTimeout(2000)
      }
      return
    }

    // Hover over each top-level item to trigger dropdowns
    const hoverCount = Math.min(topNavItems.length, 10)
    for (let i = 0; i < hoverCount; i++) {
      try {
        await topNavItems[i].hover({ timeout: 2000 })
        await page.waitForTimeout(500)
      } catch { /* ignore */ }
    }
    log(`${TAG} hovered over ${hoverCount} nav items to reveal dropdowns`)
  } catch {
    // Non-critical - just means we won't find dropdown links
  }
}

function mergePageTypeRules(
  domRules: Partial<Record<PageTypeKey, import('../shared-types').PageTypeRule>>,
  urlRegistry: UrlRegistry,
  visualClassifications: VisualClassification[],
): Partial<Record<PageTypeKey, import('../shared-types').PageTypeRule>> {
  // Start from DOM rules as a base
  const merged = { ...domRules }

  // Group all validated patterns by page type and merge into alternations
  const patternsByType = new Map<PageTypeKey, string[]>()
  for (const vp of urlRegistry.validatedPatterns) {
    if (!patternsByType.has(vp.pageType)) patternsByType.set(vp.pageType, [])
    patternsByType.get(vp.pageType)!.push(vp.pattern)
  }

  for (const [pageType, patterns] of patternsByType) {
    // Build a combined pattern from all URL registry patterns of this type
    // Only keep generic patterns (with wildcards), skip overly-specific ones
    const generic = patterns.filter(p => p.includes('[^/]+') || p.includes('[A-Z'))
    const selected = generic.length > 0 ? generic : patterns.slice(0, 8)

    // Deduplicate: if we have \/mattress\/[^/]+ and \/mattress\/[^/]+\/[A-Z0-9]{4,}
    // keep only the more specific one (the longer pattern)
    const deduplicated = deduplicatePatterns(selected)

    const combinedPattern = deduplicated.length === 1
      ? deduplicated[0]
      : `(${deduplicated.join('|')})`

    // URL registry patterns ALWAYS take precedence over DOM-derived rules
    // because they're derived from actual collected URLs (more comprehensive)
    merged[pageType] = {
      urlPattern: combinedPattern,
      label: pageType.charAt(0).toUpperCase() + pageType.slice(1),
      confidence: 95,
    }
  }

  // Ensure home always has its own pattern
  if (!merged.home) {
    merged.home = { urlPattern: '^\\/??$', label: 'Home', confidence: 95 }
  }

  // Boost confidence for VLM-confirmed classifications
  for (const vc of visualClassifications) {
    const rule = merged[vc.pageType]
    if (rule && vc.confidence > 80) {
      rule.confidence = Math.max(rule.confidence, vc.confidence)
    }
  }

  return merged
}

/**
 * Deduplicate URL patterns, keeping the most specific variant when patterns overlap.
 * E.g., \/mattress\/[^/]+ and \/mattress\/[^/]+\/[A-Z0-9]{4,} → keep both (different depth).
 * But \/furniture-store\/[^/]+ (store locations) → exclude if it's not a product pattern.
 */
function deduplicatePatterns(patterns: string[]): string[] {
  // Filter out store/utility patterns from product patterns
  const filtered = patterns.filter(p =>
    !/furniture-store|bulk-order|business/i.test(p)
  )

  // If filtering removed everything, keep the originals
  const working = filtered.length > 0 ? filtered : patterns

  // Deduplicate exact duplicates
  return [...new Set(working)]
}

function buildNavGraph(mainNav: NavEdge[]): Partial<Record<PageTypeKey, NavEdge[]>> {
  return {
    home:     mainNav,
    product:  mainNav.filter(n => n.targetPageType === 'category'),
    category: mainNav.filter(n => n.targetPageType === 'category'),
  }
}

function buildProductSchema(elements: Record<string, SelectorEntry>): SiteConfig['productSchema'] {
  const pick = (key: string) => elements[key]?.selectors[0]
  return {
    name:          pick('productTitle'),
    price:         pick('price'),
    originalPrice: pick('originalPrice'),
    rating:        pick('rating'),
    reviewCount:   pick('reviewCount'),
    highlights:    pick('highlights'),
    images:        pick('productImages'),
    addToCart:     pick('addToCart'),
  }
}

function buildListingSchema(elements: Record<string, SelectorEntry>): SiteConfig['listingSchema'] {
  const pick = (key: string) => elements[key]?.selectors[0]
  return {
    card:          pick('productCards'),
    name:          pick('productCardName'),
    price:         pick('productCardPrice'),
    rating:        pick('productCardRating'),
    link:          pick('productCards'),
    filterSidebar: pick('filterSidebar'),
  }
}

function detectPlatform(logs: string[]): string {
  const text = logs.join(' ').toLowerCase()
  if (text.includes('shopify')) return 'shopify'
  if (text.includes('magento') || text.includes('mage')) return 'magento'
  if (text.includes('woocommerce') || text.includes('woo')) return 'woocommerce'
  if (text.includes('prestashop')) return 'prestashop'
  if (text.includes('bigcommerce')) return 'bigcommerce'
  return 'custom'
}

function deriveBrandName(domain: string): string {
  const [first] = domain.split('.')
  return first.charAt(0).toUpperCase() + first.slice(1)
}

function convertElementsToFeatures(
  elements: Record<string, SelectorEntry>,
): Partial<Record<PageTypeKey, Feature[]>> {
  const features: Partial<Record<PageTypeKey, Feature[]>> = {}

  const typeMap: Record<string, { pageType: PageTypeKey; featureType: Feature['type'] }> = {
    filterSidebar: { pageType: 'category', featureType: 'filter' },
    sortDropdown:  { pageType: 'category', featureType: 'sort' },
    searchBar:     { pageType: 'home',     featureType: 'search' },
    addToCart:     { pageType: 'product',  featureType: 'cta' },
    buyNow:        { pageType: 'product',  featureType: 'cta' },
    sizeSelector:  { pageType: 'product',  featureType: 'variant' },
    colorSelector: { pageType: 'product',  featureType: 'variant' },
    productImages: { pageType: 'product',  featureType: 'gallery' },
    specsSection:  { pageType: 'product',  featureType: 'content' },
    reviewSection: { pageType: 'product',  featureType: 'content' },
  }

  for (const [key, entry] of Object.entries(elements)) {
    const mapping = typeMap[key]
    if (!mapping) continue

    if (!features[mapping.pageType]) features[mapping.pageType] = []
    features[mapping.pageType]!.push({
      id: key,
      name: key.replace(/([A-Z])/g, ' $1').trim(),
      description: `${key} element detected via DOM probing`,
      type: mapping.featureType,
      interactionMethod: entry.selectors[0]?.startsWith('button') ? 'click' : 'none',
      selector: entry.selectors[0],
    })
  }

  return features
}

// ── Supplement nav with home page links ──────────────────────────────────────

/**
 * If nav extraction found few category links, scan ALL links on the home page
 * to discover product category URLs (like /mattress, /bed, /sofa-set, etc.)
 */
async function supplementNavWithHomePageLinks(
  cc: CrawlContext,
  mainNav: NavEdge[],
): Promise<NavEdge[]> {
  // If we already found 5+ nav links, don't bother
  const categoryLinks = mainNav.filter(n => n.targetPageType === 'category')
  if (categoryLinks.length >= 5) return mainNav

  cc.log(`${TAG} nav has only ${categoryLinks.length} category links — scanning home page for more...`)

  const page = await cc.ctx.newPage()
  try {
    await navigateTo(page, cc.rootUrl, cc.log)
    await dismissPopups(page, cc.log)
    await page.waitForTimeout(3000)

    // Extract all internal links from the home page
    const homeLinks = await page.evaluate(
      ({ origin, domain }) => {
        const results: Array<{ label: string; href: string; context: string }> = []
        const seen = new Set<string>()

        const skipRe = /\/(login|register|account|signup|cart|checkout|blog|faq|contact|about|policy|terms|privacy|careers|press|investor|media|help|support|order|track|wishlist|gift|store|stores|furniture-store|dealer|franchise|bulk-order|business|referral)/i

        document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
          try {
            const u = new URL(a.href, document.baseURI)
            if (!u.hostname.includes(domain)) return
            const cleanHref = u.origin + u.pathname
            if (seen.has(cleanHref)) return
            if (u.pathname === '/' || u.pathname === '') return
            if (skipRe.test(u.pathname)) return

            // Only consider single-segment paths (top-level category pages)
            const segments = u.pathname.split('/').filter(Boolean)
            if (segments.length !== 1) return

            // Skip very short slugs and file extensions
            const slug = segments[0]
            if (slug.length < 3) return
            if (/\.(js|css|png|jpg|svg|gif|ico|json|xml)$/i.test(slug)) return

            const label = (a.textContent ?? '').trim().replace(/\s+/g, ' ')
            if (!label || label.length > 60 || label.length < 2) return

            seen.add(cleanHref)

            // Try to determine context (is this link in a nav, banner, product section?)
            const parent = a.closest('nav, header, [class*="nav"], [class*="menu"], [class*="banner"], [class*="category"], [class*="section"]')
            const context = parent ? parent.className?.toString().slice(0, 50) || parent.tagName : 'unknown'

            results.push({ label, href: cleanHref, context })
          } catch { /* skip */ }
        })

        return results
      },
      { origin: cc.origin, domain: cc.domain },
    )

    if (homeLinks.length > 0) {
      cc.log(`${TAG} found ${homeLinks.length} potential category links from home page`)

      // Convert to nav edges, dedup with existing
      const existingHrefs = new Set(mainNav.map(n => n.href))
      const supplementalNav: NavEdge[] = homeLinks
        .filter(l => !existingHrefs.has(l.href))
        .map(l => ({
          label: l.label,
          href: l.href,
          targetPageType: 'category' as PageTypeKey,
        }))

      if (supplementalNav.length > 0) {
        cc.log(`${TAG} adding ${supplementalNav.length} new category links: ${supplementalNav.map(n => n.label).join(', ')}`)
        return [...mainNav, ...supplementalNav]
      }
    }
  } catch (err) {
    cc.log(`${TAG} supplementNavWithHomePageLinks failed: ${(err as Error).message}`)
  } finally {
    await page.close()
  }

  return mainNav
}

/**
 * Pick N diverse product URLs from the registry, spread across different categories
 */
function pickDiverseProducts(
  products: import('../shared-types').ProductUrl[],
  n: number,
): string[] {
  if (products.length <= n) return products.map(p => p.url)

  // Group by category
  const groups = new Map<string, string[]>()
  for (const p of products) {
    const cat = p.category ?? '_uncategorized'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(p.url)
  }

  // Round-robin pick
  const picked: string[] = []
  const groupArrays = [...groups.values()]
  let i = 0
  while (picked.length < n) {
    const group = groupArrays[i % groupArrays.length]
    if (group && group.length > 0) {
      picked.push(group.shift()!)
    }
    i++
    if (i > 100 || groupArrays.every(g => g.length === 0)) break
  }

  return picked
}
