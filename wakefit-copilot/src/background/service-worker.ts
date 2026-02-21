chrome.runtime.onInstalled.addListener(() => {
  console.log('[Wakefit Copilot] installed')
})

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.match(/https?:\/\/(www\.)?wakefit\.co/)) {
    chrome.tabs.sendMessage(tabId, { type: 'PAGE_READY', url: tab.url })
  }
})

// ── Claude proxy (Anthropic blocks CORS from page contexts) ───────────────────

interface ClaudeProxyRequest {
  type:   'CLAUDE_FETCH'
  apiKey: string
  body:   string  // JSON-serialised ClaudeRequest
}

interface ClaudeProxyResponse {
  ok:    boolean
  text:  string
  status: number
}

// ── SiteConfig fetch proxy ────────────────────────────────────────────────────

interface ConfigFetchRequest {
  type: 'CONFIG_FETCH'
  url: string
}

interface ConfigFetchResponse {
  data?: unknown
  error?: string
}

// ── Unified message router ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: ClaudeProxyRequest | ConfigFetchRequest, _sender, sendResponse: (r: ClaudeProxyResponse | ConfigFetchResponse) => void) => {
    // ── CONFIG_FETCH ──────────────────────────────────────────────────────────
    if (msg.type === 'CONFIG_FETCH') {
      const configUrl = (msg as ConfigFetchRequest).url
      console.log(`[service-worker] CONFIG_FETCH: ${configUrl}`)
      
      fetch(configUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8_000),
      })
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            console.warn(`[service-worker] CONFIG_FETCH failed: HTTP ${res.status} - ${text.slice(0, 200)}`)
            sendResponse({ error: `HTTP ${res.status}: ${text.slice(0, 100)}` })
            return
          }
          const data = await res.json()
          console.log(`[service-worker] CONFIG_FETCH success: ${Object.keys(data).length} keys`)
          sendResponse({ data })
        })
        .catch((err: unknown) => {
          console.error(`[service-worker] CONFIG_FETCH error:`, err)
          sendResponse({ error: String(err) })
        })
      return true  // keep message channel open for async response
    }

    // ── CLAUDE_FETCH ──────────────────────────────────────────────────────────
    if (msg.type !== 'CLAUDE_FETCH') return false

    fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':                          'application/json',
        'x-api-key':                             msg.apiKey,
        'anthropic-version':                     '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: msg.body,
    })
      .then(async (res) => {
        const text = await res.text()
        sendResponse({ ok: res.ok, text, status: res.status })
      })
      .catch((err: unknown) => {
        sendResponse({ ok: false, text: String(err), status: 0 })
      })

    return true  // keep message channel open for async response
  },
)
