// ── Types ──────────────────────────────────────────────────────────────────

export interface QuickChip {
  /** Text shown in the chip button */
  label: string
  /** Full prompt sent to the LLM when the chip is tapped */
  prompt: string
}

export type PageType =
  | 'product:mattress'
  | 'product:pillow'
  | 'product:bed'
  | 'product:furniture'
  | 'product:sofa'
  | 'product:bedsheet'
  | 'product:generic'
  | 'category:mattress'
  | 'category:pillow'
  | 'category:bed'
  | 'category:furniture'
  | 'category:sofa'
  | 'category:bedsheet'
  | 'category:generic'
  | 'cart'
  | 'home'
  | 'unknown'

// ── URL → PageType detection ───────────────────────────────────────────────

// Ordered by specificity — product slug URLs have more path segments than
// category URLs. Wakefit uses: /{category}/{product-slug}
const ROUTES: Array<{ re: RegExp; type: PageType }> = [
  // Product pages (2+ path segments under a known category)
  { re: /^\/mattresses?\/.+/i,  type: 'product:mattress'   },
  { re: /^\/pillows?\/.+/i,     type: 'product:pillow'     },
  { re: /^\/beds?\/.+/i,        type: 'product:bed'        },
  { re: /^\/bed-frames?\/.+/i,  type: 'product:bed'        },
  { re: /^\/sofas?\/.+/i,       type: 'product:sofa'       },
  { re: /^\/furniture\/.+/i,    type: 'product:furniture'  },
  { re: /^\/bedsheets?\/.+/i,   type: 'product:bedsheet'   },
  { re: /^\/cushions?\/.+/i,    type: 'product:generic'    },

  // Category listing pages (just the root slug)
  { re: /^\/mattresses?\/?$/i,  type: 'category:mattress'  },
  { re: /^\/pillows?\/?$/i,     type: 'category:pillow'    },
  { re: /^\/beds?\/?$/i,        type: 'category:bed'       },
  { re: /^\/bed-frames?\/?$/i,  type: 'category:bed'       },
  { re: /^\/sofas?\/?$/i,       type: 'category:sofa'      },
  { re: /^\/furniture\/?$/i,    type: 'category:furniture' },
  { re: /^\/bedsheets?\/?$/i,   type: 'category:bedsheet'  },

  { re: /^\/cart\/?$/i,         type: 'cart'               },
  { re: /^\/?$/,                type: 'home'               },
]

export function detectPageType(url = location.href): PageType {
  const { pathname } = new URL(url)
  for (const { re, type } of ROUTES) {
    if (re.test(pathname)) return type
  }
  return 'unknown'
}

// ── Hardcoded chip sets ────────────────────────────────────────────────────
// Phase 4: replace `STATIC_CHIPS[type]` lookup with an LLM call that
// receives `ProductData` and returns `QuickChip[]`. The component API
// (`chips?: QuickChip[]` override prop) stays identical.

const STATIC_CHIPS: Record<PageType, QuickChip[]> = {
  'product:mattress': [
    { label: '📏 Show dimensions',        prompt: 'What are the exact dimensions available for this mattress?' },
    { label: '🔄 Compare with similar',   prompt: 'Compare this mattress with similar Wakefit mattresses in the same price range.' },
    { label: '📋 Trial & return policy',  prompt: 'What is the trial period and return policy for this mattress?' },
    { label: '💰 EMI options',            prompt: 'What are the EMI and financing options available for this mattress?' },
    { label: '🪵 Materials used',         prompt: 'What materials and layers is this mattress made of?' },
  ],
  'product:pillow': [
    { label: '📏 Available sizes',        prompt: 'What sizes are available for this pillow?' },
    { label: '🤔 Memory foam vs regular', prompt: 'How does this pillow compare to a regular pillow? Is memory foam worth it?' },
    { label: '🛁 Is it washable?',        prompt: 'Can this pillow be washed? What are the care instructions?' },
    { label: '📋 Trial & return policy',  prompt: 'What is the trial period and return policy for this pillow?' },
  ],
  'product:bed': [
    { label: '📏 Show dimensions',        prompt: 'What are the exact dimensions of this bed frame?' },
    { label: '🔧 Assembly required?',     prompt: 'Does this bed require assembly? How long does it take?' },
    { label: '📦 What\'s included?',      prompt: 'What is included in the box — does it come with a mattress?' },
    { label: '💰 EMI options',            prompt: 'What EMI or financing options are available for this bed?' },
  ],
  'product:sofa': [
    { label: '📏 Show dimensions',        prompt: 'What are the exact dimensions of this sofa?' },
    { label: '🔧 Assembly required?',     prompt: 'Does this sofa require assembly? Is professional installation available?' },
    { label: '🧹 Fabric care?',           prompt: 'What fabric is this sofa made of? How do I clean it?' },
    { label: '💰 EMI options',            prompt: 'What EMI or financing options are available for this sofa?' },
  ],
  'product:furniture': [
    { label: '📏 Show dimensions',        prompt: 'What are the exact dimensions of this furniture piece?' },
    { label: '🔧 Assembly required?',     prompt: 'Does this require assembly? Is professional installation available?' },
    { label: '🎨 Available finishes?',    prompt: 'What color or finish options are available for this product?' },
    { label: '💰 EMI options',            prompt: 'What are the EMI and financing options for this product?' },
  ],
  'product:bedsheet': [
    { label: '📐 Size guide',             prompt: 'What bed sizes does this bedsheet fit? Show me the size guide.' },
    { label: '🧵 Thread count?',          prompt: 'What is the thread count and fabric composition of this bedsheet?' },
    { label: '🛁 Wash instructions',      prompt: 'How should I wash and care for this bedsheet?' },
    { label: '🎨 Other colours?',         prompt: 'What other colour options are available for this bedsheet?' },
  ],
  'product:generic': [
    { label: '📏 Dimensions',             prompt: 'What are the dimensions of this product?' },
    { label: '📋 Return policy',          prompt: 'What is the return and trial policy for this product?' },
    { label: '💰 EMI options',            prompt: 'What EMI options are available for this product?' },
    { label: '🚚 Delivery timeline',      prompt: 'How long does delivery take for this product to my location?' },
  ],

  'category:mattress': [
    { label: '🏆 Best for back pain',     prompt: 'Which Wakefit mattress is best for back pain and spinal support?' },
    { label: '📊 Compare top 3',          prompt: 'Compare the top 3 Wakefit mattresses — what are the key differences?' },
    { label: '💡 Help me choose',         prompt: 'Help me choose the right Wakefit mattress. Ask me a few questions.' },
    { label: '💰 Under ₹15,000',          prompt: 'Which Wakefit mattresses are available under ₹15,000?' },
  ],
  'category:pillow': [
    { label: '💡 Which suits me?',        prompt: 'Help me choose the right Wakefit pillow based on my sleep position.' },
    { label: '🔄 Memory foam vs latex',   prompt: 'Compare memory foam and latex pillows from Wakefit.' },
    { label: '💰 Best value',             prompt: 'Which Wakefit pillow offers the best value for money?' },
    { label: '🛏️ For side sleepers',     prompt: 'Which Wakefit pillow is best for side sleepers?' },
  ],
  'category:bed': [
    { label: '📐 Size for my room',       prompt: 'What bed size should I get? My room is approximately [X] feet.' },
    { label: '💡 Help me choose',         prompt: 'Help me choose the right bed frame from Wakefit.' },
    { label: '🔧 Easy assembly?',         prompt: 'Which Wakefit beds are easiest to assemble yourself?' },
    { label: '📊 Compare top picks',      prompt: 'Compare the most popular Wakefit bed frames.' },
  ],
  'category:sofa': [
    { label: '📐 Size for my room',       prompt: 'What sofa size suits a [X] ft living room?' },
    { label: '💡 Help me choose',         prompt: 'Help me choose the right Wakefit sofa for my needs.' },
    { label: '🔄 Fabric vs leather',      prompt: 'Compare fabric and leatherette sofa options from Wakefit.' },
    { label: '📊 Compare top picks',      prompt: 'What are the most popular sofas on Wakefit right now?' },
  ],
  'category:furniture': [
    { label: '💡 Help me choose',         prompt: 'Help me find the right furniture for my bedroom or living room.' },
    { label: '🎨 See all finishes',       prompt: 'What finish and colour options are available across Wakefit furniture?' },
    { label: '💰 Under ₹10,000',          prompt: 'What Wakefit furniture is available under ₹10,000?' },
    { label: '📦 Bundle deals',           prompt: 'Are there any bundle deals or combos available on Wakefit?' },
  ],
  'category:bedsheet': [
    { label: '💡 Help me choose',         prompt: 'Help me choose the right bedsheet. What should I look for?' },
    { label: '🧵 Best thread count',      prompt: 'What thread count is best for daily use bedsheets?' },
    { label: '💰 Best value',             prompt: 'Which Wakefit bedsheets offer the best value for money?' },
    { label: '🎨 Trending colours',       prompt: 'What are the trending bedsheet colours and patterns on Wakefit?' },
  ],
  'category:generic': [
    { label: '💡 Help me choose',         prompt: 'Help me choose the right product from this category.' },
    { label: '⭐ Bestsellers',            prompt: 'What are the bestselling products in this category?' },
    { label: '💰 Best value',             prompt: 'Which product in this category offers the best value?' },
    { label: '📊 Compare options',        prompt: 'Compare the top options in this category.' },
  ],

  'cart': [
    { label: '🎁 Any discount codes?',    prompt: 'Are there any active discount codes or offers I can apply?' },
    { label: '🚚 Delivery estimate',      prompt: 'When will my order be delivered?' },
    { label: '🔄 Easy returns?',          prompt: 'What is the return process if I want to send something back?' },
    { label: '💳 Payment options',        prompt: 'What payment methods are accepted? Any cashback offers?' },
  ],
  'home': [
    { label: '🏆 Bestsellers',            prompt: 'What are Wakefit\'s bestselling products right now?' },
    { label: '💡 Help me find something', prompt: 'Help me find the right product. What are you looking for?' },
    { label: '🎯 Current offers',         prompt: 'What are the current deals and offers on Wakefit?' },
    { label: '⭐ Most reviewed',          prompt: 'Which Wakefit products have the best customer reviews?' },
  ],
  'unknown': [
    { label: '💡 Help me find something', prompt: 'Help me find the right product on Wakefit.' },
    { label: '🚚 Delivery info',          prompt: 'How does Wakefit delivery work? What are the timelines?' },
    { label: '🔄 Returns & trial',        prompt: 'What is Wakefit\'s return and trial policy?' },
    { label: '📞 Need more help',         prompt: 'I need more help — what support options does Wakefit offer?' },
  ],
}

/**
 * Resolves the chip set for a given URL.
 *
 * Phase 4 replacement: swap this function body with an async LLM call that
 * takes `ProductData` and returns `QuickChip[]`. The component accepts an
 * optional `chips` prop to receive the override without any other changes.
 */
export function resolveChips(url = location.href): QuickChip[] {
  return STATIC_CHIPS[detectPageType(url)] ?? STATIC_CHIPS['unknown']
}
