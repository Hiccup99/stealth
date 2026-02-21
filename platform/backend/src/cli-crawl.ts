/**
 * CLI entry point to run a crawl v3 directly without starting the HTTP server.
 *
 * Usage:
 *   npx tsx src/cli-crawl.ts https://www.wakefit.co [GEMINI_API_KEY]
 *
 * API key resolution order:
 *   1. Command-line argument (if provided)
 *   2. GEMINI_API_KEY environment variable (or from .env file)
 *
 * To use .env file:
 *   1. Copy .env.example to .env: cp .env.example .env
 *   2. Add your Gemini API key to .env: GEMINI_API_KEY=your_key_here
 *   3. Run the crawl: npx tsx src/cli-crawl.ts https://www.wakefit.co
 */
import 'dotenv/config'
import { crawlWebsite } from './crawler/crawl-engine'
import { getConfig } from './store/job-store'
import { v4 as uuidv4 } from 'uuid'

const url = process.argv[2]
const geminiApiKey = process.argv[3] || process.env.GEMINI_API_KEY

if (!url) {
  console.error('Usage: npx tsx src/cli-crawl.ts <url> [GEMINI_API_KEY]')
  process.exit(1)
}

const jobId = uuidv4()
console.log(`\n[cli-crawl] Starting crawl v3 of: ${url}`)
console.log(`[cli-crawl] Job ID: ${jobId}`)
console.log(`[cli-crawl] VLM: ${geminiApiKey ? 'Gemini Flash Vision' : 'DOM-only (no key)'}\n`)

crawlWebsite(jobId, url, geminiApiKey)
  .then(() => {
    const domain = new URL(url).hostname.replace(/^www\./, '')
    const config = getConfig(domain)
    if (!config) {
      console.error('[cli-crawl] ❌ Config not found after crawl')
      process.exit(1)
    }

    console.log('\n[cli-crawl] ✅ Done!')
    console.log(`[cli-crawl] Elements mapped:     ${Object.keys(config.elements).length}`)
    console.log(`[cli-crawl] Nav links:           ${config.mainNav.length}`)
    console.log(`[cli-crawl] Page types:          ${Object.keys(config.pageTypes).join(', ')}`)
    console.log(`[cli-crawl] Coverage:            ${config.coverage.overallPct}%`)
    console.log(`[cli-crawl] Products registered: ${config.urlRegistry?.products?.length ?? 0}`)
    console.log(`[cli-crawl] Features detected:   ${Object.values(config.features ?? {}).flat().length}`)
    console.log(`[cli-crawl] Recipes generated:   ${Object.keys(config.interactionRecipes ?? {}).length}`)

    if (config.coverage.uncovered.length > 0) {
      console.log(`[cli-crawl] ⚠ Uncovered intents: ${config.coverage.uncovered.join(', ')}`)
    }

    // Show URL registry summary
    if (config.urlRegistry) {
      console.log(`\n--- URL Registry ---`)
      console.log(`  Categories: ${config.urlRegistry.categories.length}`)
      console.log(`  Products:   ${config.urlRegistry.products.length}`)
      console.log(`  Patterns:   ${config.urlRegistry.validatedPatterns.length}`)
      for (const p of config.urlRegistry.validatedPatterns) {
        console.log(`    ${p.pageType}: ${p.pattern}`)
      }
    }

    // Show features summary
    if (config.features) {
      console.log(`\n--- Features ---`)
      for (const [pt, feats] of Object.entries(config.features)) {
        if (!feats || feats.length === 0) continue
        console.log(`  ${pt}: ${feats.map((f: any) => f.name).join(', ')}`)
      }
    }
  })
  .catch((err: unknown) => {
    console.error('[cli-crawl] ❌ Crawl failed:', err)
    process.exit(1)
  })
