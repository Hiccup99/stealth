import type { SiteConfig } from '@/types/site-config'

const TAG = '[Wakefit Copilot · site-config]'

// ── Config ────────────────────────────────────────────────────────────────────

/** Where to fetch configs from. Overridden in dev via environment. */
const CONFIG_API_BASE =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CONFIG_API_URL) ??
  'https://copilot-platform.railway.app'

/** Cache TTL — 24 hours */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface CachedConfig {
  config: SiteConfig
  fetchedAt: number
}

// ── In-memory state ────────────────────────────────────────────────────────────

let _current: SiteConfig | null = null
let _loading: Promise<SiteConfig | null> | null = null

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load the SiteConfig for the current domain.
 * Resolution order:
 *   1. In-memory (same page session)
 *   2. chrome.storage.local (cached for 24h)
 *   3. Remote API
 *   4. null (no config available — extension falls back to built-in selectors)
 */
export async function loadSiteConfig(domain?: string): Promise<SiteConfig | null> {
  const d = domain ?? getCurrentDomain()
  if (!d) return null

  // 1. In-memory
  if (_current && _current.domain === d) return _current

  // Deduplicate concurrent calls
  if (_loading) return _loading

  _loading = _doLoad(d).finally(() => { _loading = null })
  return _loading
}

/**
 * Returns the already-loaded config synchronously (or null if not yet loaded).
 * Use this for hot-path code that can't await.
 */
export function getSiteConfig(): SiteConfig | null {
  return _current
}

/**
 * Force-refresh the config for a domain (bypasses cache).
 */
export async function refreshSiteConfig(domain?: string): Promise<SiteConfig | null> {
  const d = domain ?? getCurrentDomain()
  if (!d) return null
  _current = null
  await clearCache(d)
  return loadSiteConfig(d)
}

// ── Internal ──────────────────────────────────────────────────────────────────

function getCurrentDomain(): string | null {
  try {
    return new URL(location.href).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

async function _doLoad(domain: string): Promise<SiteConfig | null> {
  // 2. Check chrome.storage.local cache
  const cached = await readCache(domain)
  if (cached) {
    console.debug(`${TAG} loaded from cache (age: ${Math.round((Date.now() - cached.fetchedAt) / 1000 / 60)}m)`)
    _current = cached.config
    return cached.config
  }

  // 3. Fetch from remote API
  try {
    const url = `${CONFIG_API_BASE}/config/${domain}`
    console.debug(`${TAG} fetching from ${url}`)

    const config = await fetchViaSW(url)
    if (config) {
      _current = config
      await writeCache(domain, config)
      console.debug(`${TAG} remote config loaded — ${Object.keys(config.elements).length} elements, ${config.mainNav.length} nav links`)
      return config
    }
  } catch (err) {
    console.warn(`${TAG} failed to fetch remote config:`, err)
  }

  // 4. Null — extension uses built-in fallback selectors
  console.debug(`${TAG} no config available for ${domain} — using built-in selectors`)
  return null
}

/** Fetch JSON via the extension's service worker proxy (avoids CORS). */
async function fetchViaSW(url: string): Promise<SiteConfig | null> {
  // Always use service worker proxy when available (content scripts run in page context, subject to CORS)
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'CONFIG_FETCH', url },
        (response: { data?: SiteConfig; error?: string }) => {
          if (chrome.runtime.lastError) {
            console.warn(`${TAG} service worker error:`, chrome.runtime.lastError.message)
            resolve(null)
            return
          }
          if (response?.error) {
            console.warn(`${TAG} config fetch error:`, response.error)
            resolve(null)
            return
          }
          resolve(response?.data ?? null)
        },
      )
    })
  }

  // Fallback: direct fetch (only works if CORS allows it)
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) {
      console.warn(`${TAG} config fetch failed: HTTP ${res.status}`)
      return null
    }
    return res.json()
  } catch (err) {
    console.warn(`${TAG} config fetch failed:`, err)
    return null
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

const cacheKey = (domain: string) => `site_config_${domain}`

async function readCache(domain: string): Promise<CachedConfig | null> {
  if (typeof chrome === 'undefined' || !chrome.storage) return null
  try {
    const result = await chrome.storage.local.get(cacheKey(domain))
    const entry = result[cacheKey(domain)] as CachedConfig | undefined
    if (!entry) return null
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
      // Expired — delete and return null
      await chrome.storage.local.remove(cacheKey(domain))
      return null
    }
    return entry
  } catch {
    return null
  }
}

async function writeCache(domain: string, config: SiteConfig): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return
  try {
    await chrome.storage.local.set({
      [cacheKey(domain)]: { config, fetchedAt: Date.now() } as CachedConfig,
    })
  } catch {
    // storage full or unavailable — ignore
  }
}

async function clearCache(domain: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return
  try {
    await chrome.storage.local.remove(cacheKey(domain))
  } catch {}
}
