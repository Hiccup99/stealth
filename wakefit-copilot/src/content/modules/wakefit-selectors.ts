/**
 * wakefit-selectors.ts
 *
 * Central registry of CSS selectors for key Wakefit page elements.
 * Update this file when Wakefit ships a redesign — no logic changes needed.
 *
 * Each value is a comma-separated fallback chain.
 * element-finder.ts (and querySelector directly) will try each until one matches.
 *
 * Ordering convention: most-specific / most-reliable selector first,
 * most-generic last.
 */

export const SELECTORS = {
  // ── Product page — identity ────────────────────────────────────────────────

  productTitle:
    'h1[data-testid="product-title"], h1.product-title, h1[class*="pdp-title"], h1[class*="productName"], h1',

  price:
    '[data-testid="price"], [data-testid="selling-price"], .pdp-price, .price-current, ' +
    '[class*="selling-price"], [class*="sellingPrice"], [class*="final-price"], [itemProp="price"]',

  originalPrice:
    '.price-original, .strikethrough-price, [class*="originalPrice"], [class*="original-price"], ' +
    '[class*="mrp"], [class*="strike-price"], del[class*="price"], s[class*="price"], del, s',

  rating:
    '[data-testid="rating-value"], [class*="ratingValue"], [class*="rating-value"], ' +
    '[aria-label*="rating" i], [aria-label*="stars" i]',

  reviewCount:
    '[data-testid="review-count"], [class*="reviewCount"], [class*="review-count"], ' +
    '[class*="ratings-count"], [class*="total-reviews"]',

  // ── Product page — size / variant ─────────────────────────────────────────

  sizeSelector:
    '.size-selector button, .size-options button, [data-testid="size-option"], ' +
    '[class*="sizeSelector"] button, [class*="size-selector"] button, ' +
    '[class*="variantSelector"] [role="radio"], [class*="variant-selector"] [role="radio"], ' +
    '[class*="size-picker"] button, [class*="dimension-select"] button',

  // ── Product page — specifications ─────────────────────────────────────────

  specsTable:
    '.specifications table, [class*="spec-table"], [class*="specTable"], ' +
    '[class*="specifications"] table, [class*="product-details"] table',

  specsSection:
    '#specifications, [data-section="specifications"], .product-specs, ' +
    '[class*="specification"], [class*="specifications"], [class*="product-details"], ' +
    '[class*="productDetails"], [class*="tech-specs"]',

  specsDl:
    'dl[class*="spec"], dl[class*="detail"], dl[class*="attribute"]',

  dimensionChart:
    '.dimension-chart, .size-chart, [data-testid="dimensions"], ' +
    '[class*="dimension-chart"], [class*="dimensionChart"], [class*="size-chart"]',

  // ── Product page — images / gallery ────────────────────────────────────────

  productImages:
    '[data-testid="product-images"], [data-testid="image-gallery"], [data-testid="gallery"], ' +
    '.product-images, .product-gallery, .image-gallery, .gallery, ' +
    '[class*="product-images"], [class*="productImages"], [class*="product-image"], ' +
    '[class*="product-gallery"], [class*="productGallery"], [class*="image-gallery"], ' +
    '[class*="imageGallery"], [class*="image-carousel"], [class*="imageCarousel"], ' +
    '[class*="pdp-images"], [class*="pdpImages"], [class*="pdp-image"], ' +
    '[class*="main-image"], [class*="mainImage"], [class*="hero-image"], ' +
    'figure img, .swiper-container, .slick-slider, [role="img"]',

  // ── Product page — trust / policy badges ──────────────────────────────────

  trialBanner:
    '.trial-banner, [data-testid="trial-info"], .free-trial, ' +
    '[class*="trial-period"], [class*="trialPeriod"], [class*="night-trial"], [class*="free-trial"]',

  warrantyInfo:
    '.warranty, [data-testid="warranty"], ' +
    '[class*="warranty"], [class*="guarantee"]',

  highlights:
    '.product-highlights li, .key-features li, ' +
    '[class*="highlight"] li, [class*="highlights"] li, ' +
    '[class*="feature"] li, [class*="features"] li, ' +
    '[class*="benefit"] li, [class*="benefits"] li, ' +
    '[class*="usp"] li, [class*="why-buy"] li',

  reviewSection:
    '#reviews, .reviews-section, [data-section="reviews"], ' +
    '[class*="review-section"], [class*="reviewSection"]',

  emiInfo:
    '.emi-options, .payment-options, [data-testid="emi"], ' +
    '[class*="emi-options"], [class*="emiOptions"], [class*="payment-options"]',

  // ── Category page ─────────────────────────────────────────────────────────

  productCards:
    '.product-card, .product-item, [data-testid="product-card"], ' +
    '[class*="product-card"], [class*="productCard"], [class*="card-item"]',

  filterSidebar:
    '.filter-sidebar, .filters, [data-testid="filters"], ' +
    '[class*="filter-sidebar"], [class*="filterSidebar"]',

  // ── Related / recommended products ────────────────────────────────────────

  relatedContainer:
    '[class*="related-products"], [class*="relatedProducts"], ' +
    '[class*="similar-products"], [class*="similarProducts"], ' +
    '[class*="you-may-like"], [class*="youMayLike"], ' +
    '[class*="also-bought"], [class*="recommended"]',

  relatedCard:
    '[class*="product-card"], [class*="productCard"], [class*="card-item"]',

  relatedName:
    '[class*="product-name"], [class*="productName"], [class*="name"], h3, h4',

  // ── Data attributes for size prices (checked in order) ───────────────────
  // Not CSS selectors — used as HTMLElement.dataset keys or getAttribute args
  sizePriceAttrs: 'data-price, data-selling-price, data-variant-price',
} as const

export type SelectorKey = keyof typeof SELECTORS

/**
 * Split a `SELECTORS` value back into an array for callers that need
 * to iterate selectors one-by-one rather than using querySelector's
 * built-in "first DOM match" behaviour.
 *
 * e.g. splitSelectors(SELECTORS.highlights) → ['.product-highlights li', '.key-features li', ...]
 */
export function splitSelectors(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean)
}
