/**
 * SiteConfig — the canonical artifact produced by the crawler v3
 * and consumed by the Chrome extension at runtime.
 *
 * Shared between platform/backend and wakefit-copilot extension.
 */

// ── Page types ────────────────────────────────────────────────────────────────

export type PageTypeKey = 'home' | 'product' | 'category' | 'cart' | 'search' | 'other'

export interface PageTypeRule {
  urlPattern: string
  domSignature?: string
  jsonLdType?: string
  label: string
  confidence: number
}

// ── Navigation ────────────────────────────────────────────────────────────────

export interface NavEdge {
  label: string
  href: string
  selector?: string
  targetPageType: PageTypeKey
}

// ── Element selectors ─────────────────────────────────────────────────────────

export interface SelectorEntry {
  selectors: string[]
  confidence: number
  sampleCount: number
  exampleValue?: string
}

export type ElementMap = Record<string, SelectorEntry>

// ── Product schema ────────────────────────────────────────────────────────────

export interface ProductSchema {
  name?: string
  price?: string
  originalPrice?: string
  rating?: string
  reviewCount?: string
  highlights?: string
  description?: string
  images?: string
  addToCart?: string
}

// ── Category / listing schema ─────────────────────────────────────────────────

export interface ListingSchema {
  card?: string
  name?: string
  price?: string
  rating?: string
  link?: string
  filterSidebar?: string
}

// ── Coverage report ───────────────────────────────────────────────────────────

export interface CoverageReport {
  pdpIntentsCovered: number
  pdpIntentsTotal: number
  plpIntentsCovered: number
  plpIntentsTotal: number
  globalIntentsCovered: number
  globalIntentsTotal: number
  uncovered: string[]
  overallPct: number
}

// ── URL Registry (v3) ─────────────────────────────────────────────────────────

export interface ProductUrl {
  name: string
  url: string
  category: string
}

export interface CategoryUrl {
  name: string
  url: string
}

export interface ValidatedPattern {
  pageType: PageTypeKey
  pattern: string
  examples: string[]
}

export interface UrlRegistry {
  products: ProductUrl[]
  categories: CategoryUrl[]
  validatedPatterns: ValidatedPattern[]
}

// ── Features (v3) ─────────────────────────────────────────────────────────────

export type FeatureType =
  | 'filter'
  | 'sort'
  | 'search'
  | 'variant'
  | 'cta'
  | 'navigation'
  | 'content'
  | 'gallery'

export type InteractionMethod = 'url_param' | 'click' | 'input' | 'select' | 'none'

export interface FeatureOption {
  label: string
  value: string
}

export interface Feature {
  id: string
  name: string
  description: string
  type: FeatureType
  interactionMethod: InteractionMethod
  selector?: string
  recipeId?: string
  options?: FeatureOption[]
}

// ── Interaction Recipes (v3) ──────────────────────────────────────────────────

export type RecipeStep =
  | { action: 'navigate'; url: string }
  | { action: 'click'; selector: string }
  | { action: 'url_param'; key: string; value: string; template?: string }
  | { action: 'input'; selector: string; value: string }
  | { action: 'scroll'; direction: 'down' | 'up'; amount?: number }
  | { action: 'wait'; ms: number }

export interface InteractionRecipe {
  id: string
  description: string
  pageTypes: PageTypeKey[]
  steps: RecipeStep[]
}

// ── Top-level SiteConfig ──────────────────────────────────────────────────────

export interface SiteConfig {
  domain: string
  version: string
  crawledAt: string

  crawlStats: {
    pagesVisited: number
    productSamples: number
    categorySamples: number
    durationMs: number
  }

  pageTypes: Partial<Record<PageTypeKey, PageTypeRule>>
  elements: ElementMap
  navigationGraph: Partial<Record<PageTypeKey, NavEdge[]>>
  productSchema: ProductSchema
  listingSchema: ListingSchema
  mainNav: NavEdge[]
  coverage: CoverageReport

  /** Complete URL registry built from exhaustive crawl */
  urlRegistry: UrlRegistry

  /** Interactive features detected per page type */
  features: Partial<Record<PageTypeKey, Feature[]>>

  /** Named interaction recipes the copilot can execute */
  interactionRecipes: Record<string, InteractionRecipe>

  meta: {
    brandName: string
    currency: string
    locale: string
    primaryCategories: string[]
    platform: string
  }
}

// ── Crawl job types ───────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface CrawlJob {
  jobId: string
  domain: string
  url: string
  status: JobStatus
  startedAt: string
  completedAt?: string
  error?: string
  logs: string[]
}
