/**
 * claude-cloud.ts — Anthropic Claude provider (alternative to Gemini)
 *
 * Model: claude-haiku-4-5-20251001 (fast, cheap, large context window)
 * API key stored in chrome.storage.local under 'claudeApiKey'
 * Same MESSAGE:/ACTIONS: wire format as Gemini — shared parse path
 */

import type { ProductPageData } from '../content/modules/page-scanner'
import type { AgentAction }      from '../content/modules/action-executor'
import { buildSystemPrompt }           from './prompts/system-prompt'
import { buildContextPrompt }          from './context-builder'
import { formatRequirementsForPrompt } from '../store/user-requirements-store'

type ProviderResponse = { message: string; actions: AgentAction[] }

const TAG   = '[Wakefit Copilot · claude-cloud]'
const MODEL = 'claude-haiku-4-5-20251001'

// ── Rate limiter ──────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX       = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const _timestamps: number[] = []

function checkRateLimit(): void {
  const now = Date.now()
  while (_timestamps.length > 0 && _timestamps[0]! < now - RATE_LIMIT_WINDOW_MS) {
    _timestamps.shift()
  }
  if (_timestamps.length >= RATE_LIMIT_MAX) {
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - _timestamps[0]!)
    throw new Error(`Rate limit: ${RATE_LIMIT_MAX} req/min exceeded. Retry in ${Math.ceil(waitMs / 1000)}s.`)
  }
  _timestamps.push(now)
}

// ── Service worker proxy (Anthropic doesn't set CORS headers) ─────────────────

const TIMEOUT_MS = 15_000

interface ProxyResponse { ok: boolean; text: string; status: number }

async function fetchViaSW(apiKey: string, body: string): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Claude API timed out after ${TIMEOUT_MS / 1000}s`)),
      TIMEOUT_MS,
    )
    chrome.runtime.sendMessage(
      { type: 'CLAUDE_FETCH', apiKey, body },
      (res: ProxyResponse | undefined) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (res) {
          resolve(res)
        } else {
          reject(new Error('No response from service worker'))
        }
      },
    )
  })
}

// ── API key ───────────────────────────────────────────────────────────────────

export async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('claudeApiKey')
  return (result['claudeApiKey'] as string | undefined) ?? null
}

// ── Anthropic REST types ──────────────────────────────────────────────────────

interface ClaudeMessage { role: 'user' | 'assistant'; content: string }

interface ClaudeRequest {
  model:      string
  max_tokens: number
  system:     string
  messages:   ClaudeMessage[]
}

interface ClaudeResponse {
  content?: Array<{ type: string; text: string }>
  error?:   { type: string; message: string }
}

// ── Conversation history ──────────────────────────────────────────────────────

const MAX_HISTORY_TURNS = 4
let _history: ClaudeMessage[] = []
let _historyPageUrl            = ''

export function resetHistory(): void {
  _history        = []
  _historyPageUrl = ''
  console.debug(`${TAG} conversation history cleared`)
}

// ── Response parser (same wire format as Gemini) ─────────────────────────────

const MESSAGE_RE = /^MESSAGE:\s*/im
const ACTIONS_RE = /^ACTIONS:\s*/im

function parseResponse(raw: string): ProviderResponse {
  const msgMatch     = MESSAGE_RE.exec(raw)
  const actionsMatch = ACTIONS_RE.exec(raw)

  let message: string
  if (msgMatch) {
    const end = actionsMatch ? actionsMatch.index : raw.length
    message   = raw.slice(msgMatch.index + msgMatch[0].length, end).trim()
  } else {
    message = actionsMatch ? raw.slice(0, actionsMatch.index).trim() : raw.trim()
  }

  let actions: AgentAction[] = []
  if (actionsMatch) {
    const jsonRaw    = raw.slice(actionsMatch.index + actionsMatch[0].length).trim()
    const bracketIdx = jsonRaw.indexOf('[')
    if (bracketIdx !== -1) {
      try {
        const parsed = JSON.parse(jsonRaw.slice(bracketIdx)) as unknown
        if (Array.isArray(parsed)) actions = parsed as AgentAction[]
      } catch {
        console.warn(`${TAG} actions JSON parse failed — proceeding with no actions`)
      }
    }
  }

  return { message: message || raw.trim(), actions }
}

// ── Core request ──────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [2_000, 4_000]

async function callClaude(
  apiKey:   string,
  system:   string,
  userMsg:  string,
  pageUrl:  string,
  attempt = 0,
): Promise<string> {
  if (pageUrl !== _historyPageUrl) {
    _history        = []
    _historyPageUrl = pageUrl
    console.debug(`${TAG} page changed — history reset`)
  }

  const userMessage: ClaudeMessage = { role: 'user', content: userMsg }

  const body: ClaudeRequest = {
    model:      MODEL,
    max_tokens: 512,
    system,
    messages:   [..._history, userMessage],
  }

  const res = await fetchViaSW(apiKey, JSON.stringify(body))

  if (res.status === 429 || res.status === 529) {
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay !== undefined) {
      console.warn(`${TAG} ${res.status} rate limited — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`)
      await new Promise(r => setTimeout(r, delay))
      return callClaude(apiKey, system, userMsg, pageUrl, attempt + 1)
    }
    throw new Error('QUOTA_EXCEEDED')
  }

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${res.text.slice(0, 300)}`)
  }

  const data = JSON.parse(res.text) as ClaudeResponse
  if (data.error) throw new Error(`Claude error: ${data.error.message}`)

  const text = data.content?.find(c => c.type === 'text')?.text ?? ''
  if (!text) throw new Error('Empty response from Claude API')

  const assistantMessage: ClaudeMessage = { role: 'assistant', content: text }
  _history = [..._history, userMessage, assistantMessage].slice(-(MAX_HISTORY_TURNS * 2))

  return text
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function query(
  userMessage: string,
  pageData:    ProductPageData,
): Promise<ProviderResponse> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('Claude API key not set. Open the extension popup to enter your key.')

  checkRateLimit()

  const requirementsContext = formatRequirementsForPrompt()
  const system = `${buildSystemPrompt(pageData, requirementsContext)}

PRODUCT CONTEXT:
${buildContextPrompt(pageData, userMessage)}`

  console.debug(`${TAG} querying ${MODEL} — system: ${system.length} chars`)

  const raw = await callClaude(apiKey, system, userMessage, pageData.url)
  console.debug(`${TAG} raw response:`, raw.slice(0, 200))

  return parseResponse(raw)
}
