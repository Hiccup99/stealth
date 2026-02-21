/**
 * feature-extractor.ts
 *
 * VLM-based feature detection + DOM selector mapping.
 * Takes screenshots of each page type, identifies features visually,
 * then cross-references with DOM to find matching selectors.
 */

import type { BrowserContext, Page } from 'playwright'
import type { PageTypeKey, Feature, FeatureOption } from '../shared-types'
import { detectFeaturesVisually, analyzeUrlInteractions } from './visual-analyzer'
import { dismissPopups } from './popup-handler'
import { scrollToRevealContent } from './scroll-trigger'

const TAG = '[feature-extractor]'

interface ExtractOptions {
  ctx: BrowserContext
  apiKey: string
  sampleUrls: Partial<Record<PageTypeKey, string[]>>
  log: (msg: string) => void
}

interface ExtractionResult {
  features: Partial<Record<PageTypeKey, Feature[]>>
  urlInteractionPatterns: Record<string, any>
}

export async function extractFeatures(opts: ExtractOptions): Promise<ExtractionResult> {
  const { ctx, apiKey, sampleUrls, log } = opts

  const allFeatures: Partial<Record<PageTypeKey, Feature[]>> = {}
  const urlInteractionPatterns: Record<string, any> = {}

  const pageTypes: PageTypeKey[] = ['home', 'category', 'product', 'cart']

  for (const pageType of pageTypes) {
    const urls = sampleUrls[pageType]
    if (!urls || urls.length === 0) continue

    const url = urls[0]
    log(`${TAG} extracting features for ${pageType}: ${url}`)

    const page = await ctx.newPage()
    try {
      await navigateTo(page, url, log)
      await dismissPopups(page, log)
      await scrollToRevealContent(page, log, { maxSteps: 10 })

      // VLM feature detection
      const vlmResult = await detectFeaturesVisually(page, apiKey, pageType, log)

      // Map VLM-detected features to DOM selectors
      const mappedFeatures = await mapFeaturesToDom(page, vlmResult.features, pageType, log)

      // For category pages, analyze URL interaction patterns
      if (pageType === 'category') {
        const urlPatterns = await analyzeUrlInteractions(page, apiKey, url, log)
        urlInteractionPatterns[pageType] = urlPatterns

        // Enrich filter features with URL param info
        enrichFiltersWithUrlPatterns(mappedFeatures, urlPatterns, log)
      }

      // For additional samples, verify features exist
      if (urls.length > 1) {
        log(`${TAG} verifying features across ${urls.length - 1} additional samples...`)
        for (const extraUrl of urls.slice(1, 3)) {
          await verifyFeaturesOnPage(ctx, extraUrl, mappedFeatures, log)
        }
      }

      allFeatures[pageType] = mappedFeatures
      log(`${TAG} ${pageType}: ${mappedFeatures.length} features mapped`)

    } catch (err) {
      log(`${TAG} error extracting ${pageType} features: ${(err as Error).message}`)
      allFeatures[pageType] = []
    } finally {
      await page.close()
    }
  }

  return { features: allFeatures, urlInteractionPatterns }
}

// ── DOM selector mapping ──────────────────────────────────────────────────

async function mapFeaturesToDom(
  page: Page,
  features: Feature[],
  pageType: PageTypeKey,
  log: (msg: string) => void,
): Promise<Feature[]> {
  const mapped: Feature[] = []

  for (const feature of features) {
    const selector = await findSelectorForFeature(page, feature)
    const enriched: Feature = {
      ...feature,
      selector: selector ?? undefined,
    }

    // For features with options, try to extract actual option values from DOM
    if (feature.type === 'filter' || feature.type === 'sort' || feature.type === 'variant') {
      const domOptions = await extractOptionsFromDom(page, feature, selector)
      if (domOptions.length > 0) {
        enriched.options = domOptions
      }
    }

    mapped.push(enriched)
  }

  return mapped
}

async function findSelectorForFeature(page: Page, feature: Feature): Promise<string | null> {
  const candidates = getSelectorCandidates(feature)

  for (const sel of candidates) {
    try {
      const count = await page.locator(sel).count()
      if (count > 0) return sel
    } catch {
      // bad selector
    }
  }

  // Fallback: search by text content
  const textSel = await findByVisibleText(page, feature.name)
  return textSel
}

function getSelectorCandidates(feature: Feature): string[] {
  const candidates: string[] = []
  const id = feature.id.replace(/_/g, '-')
  const idCamel = feature.id.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

  // data-testid patterns
  candidates.push(`[data-testid="${id}"]`, `[data-testid="${idCamel}"]`)

  // aria-label
  candidates.push(`[aria-label*="${feature.name}" i]`)

  switch (feature.type) {
    case 'filter':
      candidates.push(
        `[class*="filter"][class*="${id}"]`,
        `[class*="filter-${id}"]`,
        '[class*="filter-sidebar"]',
        '[class*="filterSidebar"]',
        'aside[class*="filter"]',
        '[class*="facet"]',
        '[class*="refinement"]',
      )
      break
    case 'sort':
      candidates.push(
        'select[class*="sort"]',
        '[class*="sort-by"]',
        '[class*="sortBy"]',
        '[class*="sort-dropdown"]',
        'button[class*="sort"]',
        '[aria-label*="sort" i]',
      )
      break
    case 'search':
      candidates.push(
        'input[type="search"]',
        'input[placeholder*="search" i]',
        '[class*="search-bar"] input',
        'form[role="search"] input',
      )
      break
    case 'variant':
      candidates.push(
        `[class*="${id}"]`,
        `[class*="variant-${id}"]`,
        '[class*="size-selector"]',
        '[class*="color-selector"]',
        '[class*="variant"]',
      )
      break
    case 'cta':
      candidates.push(
        'button[class*="add-to-cart"]',
        'button[class*="addToCart"]',
        'button[class*="buy-now"]',
        'button[class*="buyNow"]',
        '[class*="wishlist"]',
      )
      break
    case 'gallery':
      candidates.push(
        '[class*="product-images"]',
        '[class*="image-gallery"]',
        '[class*="carousel"]',
        '.swiper-container',
        '.slick-slider',
      )
      break
    case 'content':
      candidates.push(
        `#${id}`,
        `[data-section="${id}"]`,
        `[class*="${id}"]`,
      )
      break
    case 'navigation':
      candidates.push(
        'nav[aria-label*="breadcrumb" i]',
        '[class*="breadcrumb"]',
        '[class*="pagination"]',
        '[aria-label="pagination"]',
      )
      break
  }

  return candidates
}

async function findByVisibleText(page: Page, text: string): Promise<string | null> {
  if (!text || text.length < 3) return null

  try {
    const result = await page.evaluate((searchText) => {
      const lower = searchText.toLowerCase()
      const allEls = document.querySelectorAll('button, a, label, h1, h2, h3, h4, select, [role="button"]')
      for (const el of allEls) {
        const t = (el.textContent ?? '').trim().toLowerCase()
        if (t.includes(lower) || lower.includes(t)) {
          if (el.id) return `#${el.id}`
          if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`
          // Build a class-based selector
          const classes = Array.from(el.classList)
            .filter(c => c.length > 3 && !/^[a-z0-9]{6,}$/.test(c))
          if (classes.length > 0) return `${el.tagName.toLowerCase()}.${classes[0]}`
        }
      }
      return null
    }, text)
    return result
  } catch {
    return null
  }
}

// ── Option extraction ──────────────────────────────────────────────────────

async function extractOptionsFromDom(
  page: Page,
  feature: Feature,
  selector: string | null,
): Promise<FeatureOption[]> {
  if (!selector) return feature.options ?? []

  try {
    return await page.evaluate(
      ({ selector }) => {
        const container = document.querySelector(selector)
        if (!container) return []

        // Try select element
        if (container.tagName === 'SELECT') {
          return Array.from((container as HTMLSelectElement).options).map(o => ({
            label: o.textContent?.trim() ?? '',
            value: o.value,
          }))
        }

        // Try button/checkbox options within container
        const options = container.querySelectorAll('button, input[type="checkbox"], input[type="radio"], label, li, a')
        if (options.length > 0 && options.length < 30) {
          return Array.from(options)
            .map(o => ({
              label: (o.textContent ?? '').trim(),
              value: (o as HTMLElement).getAttribute('value') ??
                     (o as HTMLElement).getAttribute('data-value') ??
                     (o.textContent ?? '').trim(),
            }))
            .filter(o => o.label.length > 0 && o.label.length < 60)
        }

        return []
      },
      { selector },
    )
  } catch {
    return feature.options ?? []
  }
}

// ── URL pattern enrichment ──────────────────────────────────────────────────

function enrichFiltersWithUrlPatterns(
  features: Feature[],
  urlPatterns: { urlPatterns: any; usesUrlFiltering: boolean },
  log: (msg: string) => void,
): void {
  if (!urlPatterns.usesUrlFiltering) return

  const patterns = urlPatterns.urlPatterns ?? {}

  for (const feature of features) {
    if (feature.type !== 'filter' && feature.type !== 'sort') continue

    const nameLower = feature.name.toLowerCase()

    // Match price filter
    if (nameLower.includes('price') && patterns.priceFilter) {
      feature.interactionMethod = 'url_param'
      feature.id = feature.id || 'price_filter'
      log(`${TAG}   price filter: uses URL param "${patterns.priceFilter.param}"`)
    }

    // Match sort
    if (feature.type === 'sort' && patterns.sort) {
      feature.interactionMethod = 'url_param'
      feature.id = feature.id || 'sort'
      log(`${TAG}   sort: uses URL param "${patterns.sort.param}"`)
    }

    // Match other filters
    if (patterns.filters) {
      for (const filterPattern of patterns.filters) {
        if (nameLower.includes(filterPattern.param?.toLowerCase() ?? '')) {
          feature.interactionMethod = 'url_param'
          log(`${TAG}   ${feature.name}: uses URL param "${filterPattern.param}"`)
        }
      }
    }
  }
}

// ── Feature verification on additional pages ─────────────────────────────

async function verifyFeaturesOnPage(
  ctx: BrowserContext,
  url: string,
  features: Feature[],
  log: (msg: string) => void,
): Promise<void> {
  const page = await ctx.newPage()
  try {
    await navigateTo(page, url, log)
    await dismissPopups(page, log)

    let verified = 0
    for (const feature of features) {
      if (!feature.selector) continue
      try {
        const count = await page.locator(feature.selector).count()
        if (count > 0) verified++
      } catch {
        // skip
      }
    }
    log(`${TAG}   verified ${verified}/${features.filter(f => f.selector).length} features on ${url}`)
  } catch (err) {
    log(`${TAG}   verification failed for ${url}: ${(err as Error).message}`)
  } finally {
    await page.close()
  }
}

// ── Navigation helper ──────────────────────────────────────────────────────

async function navigateTo(page: Page, url: string, log: (msg: string) => void): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
      return
    } catch (err) {
      if (attempt === 2) {
        log(`${TAG} navigate failed: ${url} — ${(err as Error).message}`)
      } else {
        await page.waitForTimeout(2_000)
      }
    }
  }
}
