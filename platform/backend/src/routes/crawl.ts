import { Router, type Request, type Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { crawlWebsite } from '../crawler/crawl-engine'
import { createJob, getJob, listJobs } from '../store/job-store'

const router = Router()

/**
 * POST /crawl
 * Body: { url: string, geminiApiKey?: string }
 * Starts a crawl job asynchronously.
 *
 * API key resolution:
 *   1. Request body geminiApiKey (if provided)
 *   2. GEMINI_API_KEY from environment (.env file or system env)
 */
router.post('/', async (req: Request, res: Response) => {
  const { url, geminiApiKey } = req.body as { url?: string; geminiApiKey?: string }

  if (!url) {
    res.status(400).json({ error: '`url` is required' })
    return
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    res.status(400).json({ error: 'Invalid URL' })
    return
  }

  const domain = parsed.hostname.replace(/^www\./, '')
  const jobId  = uuidv4()
  const apiKey = geminiApiKey || process.env.GEMINI_API_KEY

  createJob(jobId, domain, url)

  // Fire-and-forget — crawlWebsite handles job status updates internally
  crawlWebsite(jobId, url, apiKey).catch(err => {
    console.error('[crawl-route] unhandled crawl error:', err)
  })

  res.json({ jobId, domain, status: 'pending', vlmEnabled: !!apiKey })
})

/**
 * GET /crawl/jobs
 * Returns all crawl jobs (most recent first).
 */
router.get('/jobs', (_req: Request, res: Response) => {
  res.json(listJobs())
})

/**
 * GET /crawl/jobs/:jobId
 * Returns a single crawl job's status and logs.
 */
router.get('/jobs/:jobId', (req: Request, res: Response) => {
  const job = getJob(req.params.jobId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  res.json(job)
})

/**
 * GET /crawl/jobs/:jobId/stream
 * Server-Sent Events stream for live log updates.
 */
router.get('/jobs/:jobId/stream', (req: Request, res: Response) => {
  const jobId = req.params.jobId
  const job = getJob(jobId)
  if (!job) {
    res.status(404).end()
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let lastIndex = 0
  const interval = setInterval(() => {
    const current = getJob(jobId)
    if (!current) {
      clearInterval(interval)
      res.end()
      return
    }

    const newLines = current.logs.slice(lastIndex)
    for (const line of newLines) {
      res.write(`data: ${JSON.stringify({ log: line })}\n\n`)
    }
    lastIndex = current.logs.length
    res.write(`data: ${JSON.stringify({ status: current.status })}\n\n`)

    if (current.status === 'done' || current.status === 'failed') {
      res.write(`data: ${JSON.stringify({ done: true, status: current.status })}\n\n`)
      clearInterval(interval)
      res.end()
    }
  }, 500)

  req.on('close', () => clearInterval(interval))
})

export default router
