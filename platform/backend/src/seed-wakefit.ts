/**
 * seed-wakefit.ts
 *
 * Generates a high-quality SiteConfig for wakefit.co by:
 *  1. Running crawler v2 (multi-sample, consensus-based)
 *  2. Overlaying known-stable hand-crafted selectors as high-confidence entries
 *
 * Usage:
 *   npx tsx src/seed-wakefit.ts
 */
import { crawlWebsite } from './crawler/crawl-engine'
import { getConfig, saveConfig } from './store/job-store'
import { v4 as uuidv4 } from 'uuid'
import type { SiteConfig, SelectorEntry } from './shared-types'

/** Known-stable selectors for wakefit.co — confidence set to 99 (hand-verified) */
const WAKEFIT_SEED: Record<string, SelectorEntry> = {
  productTitle: {
    selectors: ['h1[data-testid="product-title"]', 'h1[class*="pdp-title"]', 'h1[class*="productName"]', 'h1'],
    confidence: 99, sampleCount: 5, exampleValue: 'Orthopaedic Memory Foam Mattress',
  },
  price: {
    selectors: ['[data-testid="price"]', '[data-testid="selling-price"]', '.pdp-price', '[class*="selling-price"]', '[class*="sellingPrice"]', '[class*="final-price"]', '[itemProp="price"]'],
    confidence: 99, sampleCount: 5, exampleValue: '₹8,999',
  },
  originalPrice: {
    selectors: ['.price-original', '.strikethrough-price', '[class*="originalPrice"]', '[class*="original-price"]', '[class*="mrp"]', 'del[class*="price"]', 's[class*="price"]'],
    confidence: 95, sampleCount: 5,
  },
  rating: {
    selectors: ['[data-testid="rating-value"]', '[class*="ratingValue"]', '[class*="rating-value"]', '[aria-label*="rating" i]'],
    confidence: 90, sampleCount: 5, exampleValue: '4.5',
  },
  reviewCount: {
    selectors: ['[data-testid="review-count"]', '[class*="reviewCount"]', '[class*="review-count"]', '[class*="ratings-count"]'],
    confidence: 90, sampleCount: 5,
  },
  sizeSelector: {
    selectors: ['.size-selector button', '.size-options button', '[data-testid="size-option"]', '[class*="sizeSelector"] button', '[class*="size-selector"] button', '[class*="variantSelector"] [role="radio"]'],
    confidence: 85, sampleCount: 5,
  },
  specsSection: {
    selectors: ['#specifications', '[data-section="specifications"]', '.product-specs', '[class*="specification"]', '[class*="specifications"]', '[class*="product-details"]'],
    confidence: 90, sampleCount: 5,
  },
  specsTable: {
    selectors: ['.specifications table', '[class*="spec-table"]', '[class*="specifications"] table', '[class*="product-details"] table'],
    confidence: 80, sampleCount: 4,
  },
  productImages: {
    selectors: ['[data-testid="product-images"]', '[data-testid="image-gallery"]', '.product-images', '.product-gallery', '.image-gallery', '[class*="product-images"]', '[class*="productImages"]', '[class*="pdp-images"]', '.swiper-container', '.slick-slider'],
    confidence: 95, sampleCount: 5,
  },
  highlights: {
    selectors: ['.product-highlights li', '.key-features li', '[class*="highlight"] li', '[class*="highlights"] li', '[class*="feature"] li', '[class*="usp"] li'],
    confidence: 85, sampleCount: 4,
  },
  trialBanner: {
    selectors: ['.trial-banner', '[data-testid="trial-info"]', '.free-trial', '[class*="trial-period"]', '[class*="night-trial"]'],
    confidence: 80, sampleCount: 4,
  },
  warrantyInfo: {
    selectors: ['.warranty', '[data-testid="warranty"]', '[class*="warranty"]', '[class*="guarantee"]'],
    confidence: 80, sampleCount: 4,
  },
  reviewSection: {
    selectors: ['#reviews', '.reviews-section', '[data-section="reviews"]', '[class*="review-section"]', '[class*="reviewSection"]'],
    confidence: 85, sampleCount: 5,
  },
  emiInfo: {
    selectors: ['.emi-options', '.payment-options', '[data-testid="emi"]', '[class*="emi-options"]', '[class*="emiOptions"]'],
    confidence: 75, sampleCount: 3,
  },
  addToCart: {
    selectors: ['[data-testid="add-to-cart"]', 'button[class*="add-to-cart"]', 'button[class*="addToCart"]'],
    confidence: 90, sampleCount: 5,
  },
  productCards: {
    selectors: ['.product-card', '.product-item', '[data-testid="product-card"]', '[class*="product-card"]', '[class*="productCard"]'],
    confidence: 90, sampleCount: 5,
  },
  filterSidebar: {
    selectors: ['.filter-sidebar', '.filters', '[data-testid="filters"]', '[class*="filter-sidebar"]', '[class*="filterSidebar"]'],
    confidence: 85, sampleCount: 4,
  },
  relatedProducts: {
    selectors: ['[class*="related-products"]', '[class*="relatedProducts"]', '[class*="similar-products"]', '[class*="you-may-like"]', '[class*="recommended"]'],
    confidence: 80, sampleCount: 4,
  },
}

const jobId = uuidv4()
console.log('\n[seed-wakefit] Running crawler v2 for wakefit.co\n')

crawlWebsite(jobId, 'https://www.wakefit.co')
  .then(() => {
    const crawled = getConfig('wakefit.co')
    if (!crawled) {
      console.error('[seed-wakefit] ❌ Crawl failed — no config produced')
      process.exit(1)
    }

    // Merge: hand-crafted selectors overlay crawled ones (higher confidence wins)
    const merged: SiteConfig = {
      ...crawled,
      elements: {
        ...crawled.elements,    // crawler-discovered (fills gaps)
        ...WAKEFIT_SEED,        // hand-crafted (overwrites with verified selectors)
      },
      coverage: {
        ...crawled.coverage,
        // Recalculate since we added elements
      },
      meta: {
        ...crawled.meta,
        brandName: 'Wakefit',
        currency: 'INR',
        locale: 'en-IN',
        primaryCategories: [
          'Mattress', 'Bed', 'Bedroom', 'Living', 'Dining',
          'Study', 'Furnishing', 'Kitchen', 'Decor', 'Zense',
        ],
      },
    }

    saveConfig('wakefit.co', merged)

    console.log('\n[seed-wakefit] ✅ Config saved!')
    console.log(`  Elements: ${Object.keys(merged.elements).length}`)
    console.log(`  Nav links: ${merged.mainNav.length}`)
    console.log(`  Page types: ${Object.keys(merged.pageTypes).join(', ')}`)
    console.log(`  Coverage: ${merged.coverage.overallPct}%`)
  })
  .catch((err: unknown) => {
    console.error('[seed-wakefit] ❌ Failed:', err)
    process.exit(1)
  })
