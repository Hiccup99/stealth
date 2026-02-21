/**
 * gemini-cloud.ts — Gemini Flash API (cloud) provider
 *
 * This is the default path for MVP. Gemini Nano (Prompt API) is a
 * progressive enhancement added in llm-router.ts when available, since
 * the Chrome Built-in AI API is still experimental and not widely shipped.
 *
 * Differences vs. Nano:
 *  • ~1M token context window  → inject full product context every turn
 *  • Multi-turn history        → up to MAX_HISTORY_TURNS conversation rounds
 *  • Rate limited              → 20 req/min (sliding window)
 *  • Request timeout           → 10 seconds via AbortController
 *  • Same MESSAGE:/ACTIONS: wire format → shared parse path with Nano
 */

import type { ProductPageData } from '../content/modules/page-scanner'
import type { AgentAction } from '../content/modules/action-executor'
import { buildSystemPrompt }           from './prompts/system-prompt'
import { buildContextPrompt }          from './context-builder'
import { formatRequirementsForPrompt } from '../store/user-requirements-store'

type ProviderResponse = { message: string; actions: AgentAction[] }

const TAG   = '[Wakefit Copilot · gemini-cloud]'
const MODEL = 'gemini-2.0-flash-lite'
const API   = 'https://generativelanguage.googleapis.com/v1beta/models'

// ── Rate limiter (sliding window) ─────────────────────────────────────────────

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute

const _timestamps: number[] = []

function checkRateLimit(): void {
  const now = Date.now()
  // Evict timestamps older than the window
  while (_timestamps.length > 0 && _timestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    _timestamps.shift()
  }
  if (_timestamps.length >= RATE_LIMIT_MAX) {
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - _timestamps[0]!)
    throw new Error(
      `Rate limit: ${RATE_LIMIT_MAX} requests/min exceeded. Retry in ${Math.ceil(waitMs / 1000)}s.`,
    )
  }
  _timestamps.push(now)
}

// ── Request timeout ───────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Gemini API timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ── API key ───────────────────────────────────────────────────────────────────

export async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('geminiApiKey')
  return (result['geminiApiKey'] as string | undefined) ?? null
}

// ── Gemini REST types ─────────────────────────────────────────────────────────

interface GeminiPart    { text: string }
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

interface GeminiRequest {
  system_instruction: { parts: GeminiPart[] }
  contents:           GeminiContent[]
  generationConfig: {
    temperature:     number
    topK:            number
    topP:            number
    maxOutputTokens: number
  }
}

interface GeminiResponse {
  candidates?: Array<{ content: GeminiContent; finishReason: string }>
  error?:      { message: string; code: number }
}

// ── Conversation history ──────────────────────────────────────────────────────
// Rolling window resets on page navigation to avoid cross-page confusion.

const MAX_HISTORY_TURNS = 4
let _history: GeminiContent[] = []
let _historyPageUrl            = ''

export function resetHistory(): void {
  _history        = []
  _historyPageUrl = ''
  console.debug(`${TAG} conversation history cleared`)
}


// ── System instruction builder ────────────────────────────────────────────────

function buildSystemInstruction(pageData: ProductPageData, userMessage: string): string {
  const requirementsContext = formatRequirementsForPrompt()
  const role    = buildSystemPrompt(pageData, requirementsContext)
  const context = buildContextPrompt(pageData, userMessage)

  return `${role}

PRODUCT CONTEXT:
${context}`
}

// ── Response parser ───────────────────────────────────────────────────────────
// Identical to Nano's parser — same wire format, single parse path.

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

const RETRY_DELAYS_MS = [2_000, 4_000] // backoff for 429

async function callGemini(
  apiKey:   string,
  sysInst:  string,
  userMsg:  string,
  pageUrl:  string,
  attempt = 0,
): Promise<string> {
  if (pageUrl !== _historyPageUrl) {
    _history        = []
    _historyPageUrl = pageUrl
    console.debug(`${TAG} page changed — history reset`)
  }

  const userContent: GeminiContent = { role: 'user', parts: [{ text: userMsg }] }

  const body: GeminiRequest = {
    system_instruction: { parts: [{ text: sysInst }] },
    contents:           [..._history, userContent],
    generationConfig: {
      temperature:     0.4,
      topK:            40,
      topP:            0.95,
      maxOutputTokens: 512,
    },
  }

  const url = `${API}/${MODEL}:generateContent?key=${apiKey}`
  const res = await fetchWithTimeout(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (res.status === 429) {
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay !== undefined) {
      console.warn(`${TAG} 429 rate limited — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`)
      await new Promise(r => setTimeout(r, delay))
      return callGemini(apiKey, sysInst, userMsg, pageUrl, attempt + 1)
    }
    throw new Error('QUOTA_EXCEEDED')
  }

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`)
  }

  const data = (await res.json()) as GeminiResponse
  if (data.error) throw new Error(`Gemini error ${data.error.code}: ${data.error.message}`)

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text) throw new Error('Empty response from Gemini API')

  const modelContent: GeminiContent = { role: 'model', parts: [{ text }] }
  _history = [..._history, userContent, modelContent].slice(-(MAX_HISTORY_TURNS * 2))

  return text
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function query(
  userMessage: string,
  pageData:    ProductPageData,
): Promise<ProviderResponse> {
  checkRateLimit()

  const [apiKey, sysInst] = await Promise.all([
    getApiKey(),
    Promise.resolve(buildSystemInstruction(pageData, userMessage)),
  ])

  if (!apiKey) {
    throw new Error('Gemini API key not set. Open the extension popup to enter your key.')
  }

  console.debug(`${TAG} querying ${MODEL} — system: ${sysInst.length} chars`)

  const raw = await callGemini(apiKey, sysInst, userMessage, pageData.url)
  console.debug(`${TAG} raw response:`, raw.slice(0, 200))

  return parseResponse(raw)
}
