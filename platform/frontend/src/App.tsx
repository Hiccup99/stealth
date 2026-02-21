import { useState, useEffect, useCallback, useRef } from 'react'
import {
  triggerCrawl, getJob, listJobs, listConfigs, getFullConfig,
  type JobSummary, type ConfigSummary,
} from './api'

// ── Styles (inline for zero-dependency) ────────────────────────────────────

const S = {
  container: {
    maxWidth: 900,
    margin: '0 auto',
    padding: '32px 24px',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 40,
  } as React.CSSProperties,
  logo: {
    width: 36,
    height: 36,
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
  } as React.CSSProperties,
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#f1f1f1',
    margin: 0,
  } as React.CSSProperties,
  subtitle: {
    fontSize: 13,
    color: '#888',
    margin: 0,
  } as React.CSSProperties,
  card: {
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 20,
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#999',
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  inputRow: {
    display: 'flex',
    gap: 10,
  } as React.CSSProperties,
  input: {
    flex: 1,
    background: '#111',
    border: '1px solid #333',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#e5e5e5',
    fontSize: 15,
    outline: 'none',
  } as React.CSSProperties,
  btn: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    border: 'none',
    borderRadius: 8,
    padding: '10px 20px',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#ccc',
    marginBottom: 12,
    marginTop: 0,
  } as React.CSSProperties,
  logBox: {
    background: '#0a0a0a',
    border: '1px solid #222',
    borderRadius: 8,
    padding: '12px 14px',
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#7cf07c',
    maxHeight: 260,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  badge: (status: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    background:
      status === 'done'    ? '#16a34a22' :
      status === 'running' ? '#d9770622' :
      status === 'failed'  ? '#dc262622' : '#33333366',
    color:
      status === 'done'    ? '#4ade80' :
      status === 'running' ? '#fb923c' :
      status === 'failed'  ? '#f87171' : '#888',
  } as React.CSSProperties),
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    textAlign: 'left' as const,
    padding: '8px 10px',
    fontSize: 11,
    fontWeight: 700,
    color: '#666',
    textTransform: 'uppercase' as const,
    borderBottom: '1px solid #222',
  },
  td: {
    padding: '10px',
    fontSize: 13,
    color: '#ccc',
    borderBottom: '1px solid #1e1e1e',
  },
  jsonViewer: {
    background: '#0a0a0a',
    border: '1px solid #222',
    borderRadius: 8,
    padding: '14px',
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#93c5fd',
    maxHeight: 400,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
  },
  error: {
    background: '#dc262622',
    border: '1px solid #dc262644',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#f87171',
    fontSize: 13,
    marginTop: 8,
  },
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [url, setUrl]             = useState('https://www.wakefit.co')
  const [geminiKey, setGeminiKey] = useState('')
  const [crawling, setCrawling]   = useState(false)
  const [activeJob, setActiveJob] = useState<JobSummary | null>(null)
  const [jobs, setJobs]           = useState<JobSummary[]>([])
  const [configs, setConfigs]     = useState<ConfigSummary[]>([])
  const [selectedConfig, setSelectedConfig] = useState<unknown>(null)
  const [crawlError, setCrawlError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load initial data
  useEffect(() => {
    refresh()
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [activeJob?.logs])

  const refresh = useCallback(async () => {
    const [j, c] = await Promise.all([listJobs(), listConfigs()])
    setJobs(j)
    setConfigs(c)
  }, [])

  const startCrawl = async () => {
    if (!url.trim()) return
    setCrawlError(null)
    setCrawling(true)
    setActiveJob(null)

    try {
      const { jobId } = await triggerCrawl(url.trim(), geminiKey.trim() || undefined)

      // Start polling
      pollRef.current = setInterval(async () => {
        const job = await getJob(jobId)
        setActiveJob(job)

        if (job.status === 'done' || job.status === 'failed') {
          clearInterval(pollRef.current!)
          setCrawling(false)
          refresh()
        }
      }, 800)
    } catch (err) {
      setCrawlError((err as Error).message)
      setCrawling(false)
    }
  }

  const viewConfig = async (domain: string) => {
    try {
      const config = await getFullConfig(domain)
      setSelectedConfig(config)
    } catch (err) {
      setSelectedConfig({ error: (err as Error).message })
    }
  }

  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>🕷️</div>
        <div>
          <h1 style={S.title}>Copilot Platform</h1>
          <p style={S.subtitle}>Site Intelligence Crawler — Admin</p>
        </div>
      </div>

      {/* Crawl trigger */}
      <div style={S.card}>
        <p style={S.sectionTitle}>Crawl a New Website</p>
        <label style={S.label}>Website URL</label>
        <div style={S.inputRow}>
          <input
            style={S.input}
            type="url"
            placeholder="https://www.example.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !crawling && startCrawl()}
          />
          <button
            style={{ ...S.btn, ...(crawling ? S.btnDisabled : {}) }}
            onClick={startCrawl}
            disabled={crawling}
          >
            {crawling ? '⏳ Crawling…' : '🚀 Start Crawl'}
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={S.label}>Gemini API Key (enables VLM-based feature detection)</label>
          <input
            style={S.input}
            type="password"
            placeholder="AIza... (optional — leave empty for DOM-only crawl)"
            value={geminiKey}
            onChange={e => setGeminiKey(e.target.value)}
          />
        </div>
        {crawlError && <div style={S.error}>{crawlError}</div>}
      </div>

      {/* Active job */}
      {activeJob && (
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>
              Job: <code style={{ fontSize: 12, color: '#888' }}>{activeJob.jobId.slice(0, 8)}…</code>
            </p>
            <span style={S.badge(activeJob.status)}>
              {activeJob.status.toUpperCase()}
            </span>
          </div>
          <div style={S.logBox} ref={logRef}>
            {activeJob.logs.join('\n') || 'Waiting for logs…'}
          </div>
          {activeJob.status === 'failed' && activeJob.error && (
            <div style={S.error}>Error: {activeJob.error}</div>
          )}
          {activeJob.status === 'done' && (
            <div style={{ marginTop: 10, color: '#4ade80', fontSize: 13 }}>
              ✅ Crawl complete! Config is ready.
            </div>
          )}
        </div>
      )}

      {/* Available configs */}
      {configs.length > 0 && (
        <div style={S.card}>
          <p style={S.sectionTitle}>Available Site Configs</p>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Domain</th>
                <th style={S.th}>Version</th>
                <th style={S.th}>Crawled</th>
                <th style={S.th}>Elements</th>
                <th style={S.th}>Products</th>
                <th style={S.th}>Features</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {configs.map(c => (
                <tr key={c.domain}>
                  <td style={S.td}><strong>{c.domain}</strong></td>
                  <td style={S.td}>{c.version}</td>
                  <td style={S.td}>{new Date(c.crawledAt).toLocaleString()}</td>
                  <td style={S.td}>{c.elementCount}</td>
                  <td style={S.td}>{c.productCount ?? '—'}</td>
                  <td style={S.td}>{c.featureCount ?? '—'}</td>
                  <td style={S.td}>
                    <button
                      style={{ ...S.btn, padding: '4px 12px', fontSize: 12 }}
                      onClick={() => viewConfig(c.domain)}
                    >
                      View JSON
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* JSON viewer */}
      {selectedConfig && (
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ ...S.sectionTitle, margin: 0 }}>SiteConfig JSON</p>
            <button
              style={{ ...S.btn, padding: '4px 12px', fontSize: 12, background: '#333' }}
              onClick={() => setSelectedConfig(null)}
            >
              Close
            </button>
          </div>
          <div style={S.jsonViewer}>
            {JSON.stringify(selectedConfig, null, 2)}
          </div>
        </div>
      )}

      {/* Past jobs */}
      {jobs.length > 0 && (
        <div style={S.card}>
          <p style={S.sectionTitle}>Recent Jobs</p>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Domain</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Started</th>
                <th style={S.th}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 10).map(j => (
                <tr key={j.jobId} style={{ cursor: 'pointer' }} onClick={() => setActiveJob(j)}>
                  <td style={S.td}>{j.domain}</td>
                  <td style={S.td}><span style={S.badge(j.status)}>{j.status}</span></td>
                  <td style={S.td}>{new Date(j.startedAt).toLocaleTimeString()}</td>
                  <td style={S.td}>{j.completedAt ? new Date(j.completedAt).toLocaleTimeString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
