import fs from 'fs'
import path from 'path'
import type { CrawlJob, SiteConfig, JobStatus } from '../shared-types'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')
const CONFIGS_DIR = path.join(DATA_DIR, 'configs')

// Ensure directories exist
function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(CONFIGS_DIR, { recursive: true })
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

function readJobs(): Record<string, CrawlJob> {
  ensureDirs()
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function writeJobs(jobs: Record<string, CrawlJob>): void {
  ensureDirs()
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2))
}

export function createJob(jobId: string, domain: string, url: string): CrawlJob {
  const job: CrawlJob = {
    jobId,
    domain,
    url,
    status: 'pending',
    startedAt: new Date().toISOString(),
    logs: [],
  }
  const jobs = readJobs()
  jobs[jobId] = job
  writeJobs(jobs)
  return job
}

export function getJob(jobId: string): CrawlJob | null {
  const jobs = readJobs()
  return jobs[jobId] ?? null
}

export function updateJobStatus(
  jobId: string,
  status: JobStatus,
  extra?: Partial<CrawlJob>,
): void {
  const jobs = readJobs()
  if (jobs[jobId]) {
    jobs[jobId] = { ...jobs[jobId], status, ...extra }
    if (status === 'done' || status === 'failed') {
      jobs[jobId].completedAt = new Date().toISOString()
    }
    writeJobs(jobs)
  }
}

export function appendJobLog(jobId: string, line: string): void {
  const jobs = readJobs()
  if (jobs[jobId]) {
    jobs[jobId].logs.push(line)
    writeJobs(jobs)
  }
}

export function listJobs(): CrawlJob[] {
  const jobs = readJobs()
  return Object.values(jobs).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
}

// ── Configs ───────────────────────────────────────────────────────────────────

export function saveConfig(domain: string, config: SiteConfig): void {
  ensureDirs()
  const file = path.join(CONFIGS_DIR, `${domain}.json`)
  fs.writeFileSync(file, JSON.stringify(config, null, 2))
}

export function getConfig(domain: string): SiteConfig | null {
  ensureDirs()
  const file = path.join(CONFIGS_DIR, `${domain}.json`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

// ── Aliases used by crawl-engine ──────────────────────────────────────────────

/** Update any fields on a job (used by crawl-engine) */
export async function updateJob(jobId: string, updates: Partial<CrawlJob>): Promise<void> {
  const jobs = readJobs()
  if (jobs[jobId]) {
    jobs[jobId] = { ...jobs[jobId], ...updates }
    writeJobs(jobs)
  }
}

/** Save a SiteConfig (alias for saveConfig, used by crawl-engine) */
export async function saveSiteConfig(config: SiteConfig): Promise<void> {
  saveConfig(config.domain, config)
}

export function listConfigs(): SiteConfig[] {
  ensureDirs()
  return fs
    .readdirSync(CONFIGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, f), 'utf-8'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
