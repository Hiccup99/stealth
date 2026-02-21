import type { ProductPageData } from '../content/modules/page-scanner'

// ── Context formatter ─────────────────────────────────────────────────────────

/**
 * Compact, token-efficient product context string.
 * Stays under ~600 tokens so it fits comfortably inside Gemini Nano's window.
 */
export function buildContext(page: ProductPageData): string {
  if (page.pageType !== 'product' || !page.product) {
    return `Page type: ${page.pageType}\nURL: ${page.url}`
  }

  const p    = page.product
  const fmt  = (n: number) => `₹${n.toLocaleString('en-IN')}`
  const lines: string[] = []

  lines.push(`Product: ${p.name}`)
  lines.push(`Price: ${fmt(p.price)}${p.originalPrice ? ` (MRP: ${fmt(p.originalPrice)})` : ''}`)

  if (p.rating)      lines.push(`Rating: ${p.rating}/5 (${p.reviewCount ?? '?'} reviews)`)
  if (p.trialPeriod) lines.push(`Trial: ${p.trialPeriod}`)
  if (p.warranty)    lines.push(`Warranty: ${p.warranty}`)

  if (p.sizes.length > 0) {
    const sizeList = p.sizes.slice(0, 6).map(s =>
      s.price > 0 ? `${s.label} (${fmt(s.price)})` : s.label
    ).join(', ')
    lines.push(`Available sizes: ${sizeList}`)
  }

  if (p.highlights.length > 0) {
    lines.push('Key highlights:')
    p.highlights.slice(0, 5).forEach(h => lines.push(`  • ${h}`))
  }

  const specEntries = Object.entries(p.specifications).slice(0, 12)
  if (specEntries.length > 0) {
    lines.push('Specifications:')
    specEntries.forEach(([k, v]) => lines.push(`  ${k}: ${v}`))
  }

  if (page.relatedProducts && page.relatedProducts.length > 0) {
    const related = page.relatedProducts.slice(0, 3)
      .map(r => `${r.name} (${fmt(r.price)})`)
      .join(', ')
    lines.push(`Related products: ${related}`)
  }

  return lines.join('\n')
}

// ── System prompt ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `\
You are Wakefit Co-Pilot, a helpful AI shopping assistant embedded on wakefit.co.
Help customers understand products and make confident purchase decisions.
Be concise, warm, and factual. Use the product context provided.

RESPONSE FORMAT — always reply with valid JSON (no markdown fences, no extra text):
{
  "message": "Conversational reply. Supports **bold** and *italic*.",
  "actions": []
}

AVAILABLE ACTIONS (include 0–3 per response):
{ "type": "scroll_to",    "target": "<intent>",                          "label": "optional" }
{ "type": "highlight",    "target": "<intent>",                          "label": "optional" }
{ "type": "walk_through", "targets": ["<intent>", "<intent>"]                                }
{ "type": "compare",      "items":   [{"target":"<intent>","label":"…"}]                     }

VALID TARGETS: specifications, price, original price, sizes, trial, warranty,
               highlights, dimensions, reviews, emi, related

EXAMPLES
User: "What trial period does this come with?"
→ {"message":"This mattress includes a **100-night free trial**. If you don't love it, return it hassle-free.","actions":[{"type":"highlight","target":"trial","label":"100-Night Trial ✓"}]}

User: "Walk me through the key features"
→ {"message":"Sure! Let me guide you through the highlights.","actions":[{"type":"walk_through","targets":["highlights","specifications","dimensions"]}]}

User: "Compare king and queen sizes"
→ {"message":"Here are both sizes highlighted so you can compare.","actions":[{"type":"compare","items":[{"target":"sizes","label":"Size Options"}]}]}`

// ── Response parser ────────────────────────────────────────────────────────────

export interface RawAgentResponse {
  message: string
  actions: unknown[]
}

/** Strip optional markdown code fences the model might wrap JSON in */
function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
}

/**
 * Parse and validate an LLM response string → `RawAgentResponse`.
 * Falls back to a plain-text answer if JSON is malformed.
 */
export function parseResponse(raw: string): RawAgentResponse {
  const cleaned = stripFences(raw.trim())

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    return {
      message: typeof parsed['message'] === 'string' ? parsed['message'] : cleaned,
      actions: Array.isArray(parsed['actions']) ? parsed['actions'] : [],
    }
  } catch {
    // Model returned plain prose — wrap it as a plain answer
    return { message: cleaned || 'I couldn\'t process that. Please try again.', actions: [] }
  }
}
