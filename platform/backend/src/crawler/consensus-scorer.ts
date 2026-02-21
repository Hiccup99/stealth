/**
 * consensus-scorer.ts
 *
 * Aggregates per-page selector probe results across multiple page samples
 * and produces a single SelectorEntry per intent.
 *
 * Algorithm (per intent):
 *  1. Collect all selectors that matched at least once across samples
 *  2. For each selector, count:
 *       - matchCount:   pages where it existed in DOM
 *       - contentCount: pages where it also passed content verification
 *  3. Keep only selectors where contentCount / sampleCount ≥ CONTENT_THRESHOLD
 *  4. Sort by (contentCount DESC, selectorScore DESC)
 *  5. Assign confidence = (contentCount / sampleCount) * 100 * stabilityMultiplier
 *  6. Take top-N selectors as the fallback chain
 *
 * Selector stability scoring:
 *   data-testid  → 1.0
 *   #id          → 0.95
 *   aria-*       → 0.85
 *   itemProp     → 0.80
 *   kebab-class  → 0.70
 *   camelClass   → 0.55
 *   hash-class   → 0.20
 */

import type { SelectorEntry } from '../shared-types'
import type { VerifyMode } from './ecommerce-taxonomy'

const CONTENT_THRESHOLD  = 0.34  // selector must have real content on ≥ 1/3 of samples
const MAX_FALLBACKS      = 5     // max selectors kept per intent

// ── Stability multiplier ──────────────────────────────────────────────────────

function stabilityScore(sel: string): number {
  if (sel.includes('data-testid') || sel.includes('data-test-id')) return 1.0
  if (/^#[a-z][a-z0-9-]+/.test(sel) || sel.includes('[id=')) return 0.95
  if (sel.includes('aria-label') || sel.includes('[role=') || sel.includes('[role="')) return 0.85
  if (sel.includes('itemProp') || sel.includes('itemprop')) return 0.80
  if (sel.includes('[name=')) return 0.75
  // kebab-case class names tend to be human-written and stable
  if (/\.[a-z][a-z0-9]*(?:-[a-z][a-z0-9]+)+/.test(sel)) return 0.70
  // semantic HTML tag + attribute
  if (/^(button|input|select|textarea|a)\[/.test(sel)) return 0.65
  // camelCase class — may be compiled but less likely than pure hash
  if (/\.[a-z][a-z]*[A-Z][a-zA-Z]+/.test(sel)) return 0.55
  // long alphanumeric hash class
  if (/\.[a-zA-Z0-9_-]{12,}/.test(sel)) return 0.20
  return 0.50
}

// ── Per-page probe result ─────────────────────────────────────────────────────

/** Result from probing one selector on one page */
export interface ProbeResult {
  selector: string
  matched: boolean   // found in DOM
  verified: boolean  // passed content verification
  exampleValue?: string
}

/** All probe results for all intents on one page */
export type PageProbeResults = Record<string, ProbeResult[]>

// ── Consensus scoring ─────────────────────────────────────────────────────────

/**
 * Given probe results from multiple pages, produce a SelectorEntry per intent.
 *
 * @param allPageResults  Array of PageProbeResults — one per crawled page sample
 * @param verifyModes     Map from intent → VerifyMode (to know what mode was used)
 * @returns               Map from intent → SelectorEntry
 */
export function scoreConsensus(
  allPageResults: PageProbeResults[],
  verifyModes: Record<string, VerifyMode>,
): Record<string, SelectorEntry> {
  const sampleCount = allPageResults.length
  if (sampleCount === 0) return {}

  // Collect all intents
  const intents = new Set<string>()
  for (const pageResult of allPageResults) {
    for (const intent of Object.keys(pageResult)) {
      intents.add(intent)
    }
  }

  const output: Record<string, SelectorEntry> = {}

  for (const intent of intents) {
    // Aggregate per selector
    const selectorStats = new Map<string, {
      matchCount: number
      contentCount: number
      exampleValues: string[]
    }>()

    let samplesContaining = 0

    for (const pageResult of allPageResults) {
      const probes = pageResult[intent] ?? []
      const anyMatch = probes.some(p => p.matched)
      if (anyMatch) samplesContaining++

      for (const probe of probes) {
        if (!selectorStats.has(probe.selector)) {
          selectorStats.set(probe.selector, { matchCount: 0, contentCount: 0, exampleValues: [] })
        }
        const stats = selectorStats.get(probe.selector)!
        if (probe.matched) stats.matchCount++
        if (probe.verified) {
          stats.contentCount++
          if (probe.exampleValue) stats.exampleValues.push(probe.exampleValue)
        }
      }
    }

    // Filter: keep only selectors that passed content check on ≥ threshold of samples
    const qualified = [...selectorStats.entries()]
      .filter(([, stats]) => stats.contentCount / sampleCount >= CONTENT_THRESHOLD)
      .sort(([selA, statsA], [selB, statsB]) => {
        // Primary: content count DESC
        const diff = statsB.contentCount - statsA.contentCount
        if (diff !== 0) return diff
        // Secondary: stability score DESC
        return stabilityScore(selB) - stabilityScore(selA)
      })
      .slice(0, MAX_FALLBACKS)

    if (qualified.length === 0) continue

    const [bestSel, bestStats] = qualified[0]
    const confidence = Math.round(
      (bestStats.contentCount / sampleCount) * 100 * stabilityScore(bestSel)
    )

    output[intent] = {
      selectors: qualified.map(([sel]) => sel),
      confidence: Math.min(100, confidence),
      sampleCount: samplesContaining,
      exampleValue: bestStats.exampleValues[0],
    }
  }

  return output
}

// ── Coverage calculation ──────────────────────────────────────────────────────

import { TAXONOMY_GROUPS } from './ecommerce-taxonomy'

const CONFIDENCE_THRESHOLD = 50

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

export function calculateCoverage(elements: Record<string, SelectorEntry>): CoverageReport {
  const covered = (keys: string[]) =>
    keys.filter(k => elements[k] && elements[k].confidence >= CONFIDENCE_THRESHOLD).length

  const pdpCovered     = covered(TAXONOMY_GROUPS.pdp)
  const plpCovered     = covered(TAXONOMY_GROUPS.plp)
  const globalCovered  = covered(TAXONOMY_GROUPS.global)

  const totalCovered   = pdpCovered + plpCovered + globalCovered
  const total          = TAXONOMY_GROUPS.pdp.length + TAXONOMY_GROUPS.plp.length + TAXONOMY_GROUPS.global.length

  const allIntents     = [...TAXONOMY_GROUPS.pdp, ...TAXONOMY_GROUPS.plp, ...TAXONOMY_GROUPS.global, ...TAXONOMY_GROUPS.cart]
  const uncovered      = allIntents.filter(k => !elements[k] || elements[k].confidence < CONFIDENCE_THRESHOLD)

  return {
    pdpIntentsCovered:    pdpCovered,
    pdpIntentsTotal:      TAXONOMY_GROUPS.pdp.length,
    plpIntentsCovered:    plpCovered,
    plpIntentsTotal:      TAXONOMY_GROUPS.plp.length,
    globalIntentsCovered: globalCovered,
    globalIntentsTotal:   TAXONOMY_GROUPS.global.length,
    uncovered,
    overallPct:           total > 0 ? Math.round((totalCovered / total) * 100) : 0,
  }
}
