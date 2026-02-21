const BASE = import.meta.env.VITE_API_URL ?? ''

export interface JobSummary {
  jobId: string
  domain: string
  url: string
  status: 'pending' | 'running' | 'done' | 'failed'
  startedAt: string
  completedAt?: string
  error?: string
  logs: string[]
}

export interface ConfigSummary {
  domain: string
  version: string
  crawledAt: string
  elementCount: number
  navLinkCount: number
  productCount?: number
  featureCount?: number
  recipeCount?: number
}

export async function triggerCrawl(url: string, geminiApiKey?: string): Promise<{ jobId: string; vlmEnabled: boolean }> {
  const body: Record<string, string> = { url }
  if (geminiApiKey) body.geminiApiKey = geminiApiKey

  const res = await fetch(`${BASE}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Crawl failed')
  }
  return res.json()
}

export async function getJob(jobId: string): Promise<JobSummary> {
  const res = await fetch(`${BASE}/crawl/jobs/${jobId}`)
  if (!res.ok) throw new Error('Job not found')
  return res.json()
}

export async function listJobs(): Promise<JobSummary[]> {
  const res = await fetch(`${BASE}/crawl/jobs`)
  if (!res.ok) return []
  return res.json()
}

export async function listConfigs(): Promise<ConfigSummary[]> {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) return []
  return res.json()
}

export async function getFullConfig(domain: string): Promise<unknown> {
  const res = await fetch(`${BASE}/config/${domain}`)
  if (!res.ok) throw new Error('Config not found')
  return res.json()
}
