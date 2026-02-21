import { Router, type Request, type Response } from 'express'
import { getConfig, listConfigs, saveConfig } from '../store/job-store'

const router = Router()

/**
 * GET /config/:domain
 * Returns the latest SiteConfig for a domain.
 * The extension fetches this at content-script init time.
 */
router.get('/:domain', (req: Request, res: Response) => {
  const domain = req.params.domain.replace(/^www\./, '')
  const config = getConfig(domain)

  if (!config) {
    res.status(404).json({
      error: `No config found for domain: ${domain}`,
      hint: 'Trigger a crawl via POST /crawl first.',
    })
    return
  }

  // Allow extension to cache for 24h
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
  res.json(config)
})

/**
 * GET /config
 * Lists all available domain configs (for the admin UI).
 */
router.get('/', (_req: Request, res: Response) => {
  const configs = listConfigs()
  res.json(
    configs.map(c => ({
      domain:       c.domain,
      version:      c.version,
      crawledAt:    c.crawledAt,
      elementCount: Object.keys(c.elements).length,
      navLinkCount: c.mainNav.length,
      productCount: c.urlRegistry?.products?.length ?? 0,
      featureCount: Object.values(c.features ?? {}).flat().length,
      recipeCount:  Object.keys(c.interactionRecipes ?? {}).length,
    }))
  )
})

/**
 * PUT /config/:domain
 * Manually upload / update a SiteConfig (for hand-tuned corrections).
 */
router.put('/:domain', (req: Request, res: Response) => {
  const domain = req.params.domain.replace(/^www\./, '')
  const body = req.body

  if (!body || typeof body !== 'object' || !body.domain) {
    res.status(400).json({ error: 'Invalid SiteConfig body' })
    return
  }

  saveConfig(domain, { ...body, domain })
  res.json({ ok: true, domain })
})

export default router
