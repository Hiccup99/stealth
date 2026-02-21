import type { ProductPageData } from '../content/modules/page-scanner'
import type { AgentAction }      from '../content/modules/action-executor'
import * as nano   from './gemini-nano'
import * as gemini from './gemini-cloud'
import * as claude from './claude-cloud'
import * as perf   from '../content/modules/performance-monitor'

// ── Public types ──────────────────────────────────────────────────────────────

export type LLMMode = 'nano' | 'gemini' | 'claude'

export interface AgentResponse {
  message: string
  actions: AgentAction[]
  mode:    LLMMode
  /** True if LLM is completely unavailable (no keys, all providers failed) */
  unavailable?: boolean
}

const TAG = '[Wakefit Copilot · llm-router]'

// ── Capability detection ──────────────────────────────────────────────────────

let _cachedMode: LLMMode | null = null

/**
 * Detect the best available backend:
 *   nano   → Chrome Built-in AI (Prompt API) ready
 *   claude → Claude API key is stored
 *   gemini → Gemini API key is stored (fallback)
 *
 * Result is cached per page load.
 */
export async function detectCapability(): Promise<LLMMode> {
  if (_cachedMode) return _cachedMode

  // 1. Try Gemini Nano (on-device, free, no key needed)
  try {
    if (
      typeof window !== 'undefined' &&
      'ai' in window &&
      window.ai != null &&
      'languageModel' in window.ai
    ) {
      const caps = await window.ai.languageModel.capabilities()
      if (caps.available === 'readily' || caps.available === 'after-download') {
        console.debug(`${TAG} Gemini Nano available (${caps.available})`)
        _cachedMode = 'nano'
        return 'nano'
      }
    }
  } catch (err) {
    console.warn(`${TAG} Nano capability check failed:`, err)
  }

  // 2. Prefer Claude if key is present
  const claudeKey = await claude.getApiKey()
  if (claudeKey) {
    console.debug(`${TAG} Claude key found — routing to Claude`)
    _cachedMode = 'claude'
    return 'claude'
  }

  // 3. Fall back to Gemini
  console.debug(`${TAG} routing to Gemini`)
  _cachedMode = 'gemini'
  return 'gemini'
}

export function resetCapabilityCache(): void {
  _cachedMode = null
}

// ── Main query ────────────────────────────────────────────────────────────────

export async function query(
  prompt:  string,
  context: ProductPageData,
): Promise<AgentResponse> {
  const mode = await detectCapability()
  console.debug(`${TAG} routing to: ${mode}`)

  // ── Nano ──────────────────────────────────────────────────────────────────
  if (mode === 'nano') {
    try {
      const start = performance.now()
      const res = await nano.query(prompt, context)
      perf.recordLLMResponse('nano', performance.now() - start)
      return { ...res, mode: 'nano' }
    } catch (err) {
      console.warn(`${TAG} Nano failed, falling back to cloud:`, err)
      _cachedMode = null
    }
  }

  // ── Claude — always check fresh (key may have been added after page load) ─
  const claudeKey = await claude.getApiKey()
  if (claudeKey) {
    try {
      const start = performance.now()
      const res = await claude.query(prompt, context)
      perf.recordLLMResponse('cloud', performance.now() - start)
      _cachedMode = 'claude'
      return { ...res, mode: 'claude' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${TAG} Claude query failed:`, err)
      // Don't mark unavailable here — fall through to Gemini
      return { message: cloudErrorMessage(msg, 'Claude'), actions: [], mode: 'claude' }
    }
  }

  // ── Gemini fallback ───────────────────────────────────────────────────────
  try {
    const geminiKey = await gemini.getApiKey()
    if (!geminiKey) {
      return { message: '', actions: [], mode: 'gemini', unavailable: true }
    }
    const start = performance.now()
    const res = await gemini.query(prompt, context)
    perf.recordLLMResponse('cloud', performance.now() - start)
    _cachedMode = 'gemini'
    return { ...res, mode: 'gemini' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${TAG} Gemini query failed:`, err)
    // Check if it's a key error — if so, mark as unavailable
    if (msg.includes('key not set') || msg.includes('API key')) {
      return { message: '', actions: [], mode: 'gemini', unavailable: true }
    }
    return { message: cloudErrorMessage(msg, 'Gemini'), actions: [], mode: 'gemini' }
  }
}

function cloudErrorMessage(errMessage: string, provider: string): string {
  if (errMessage.includes('key not set') || errMessage.includes('API key')) {
    return `Please add your ${provider} API key in the extension popup to enable AI responses.`
  }
  if (errMessage === 'QUOTA_EXCEEDED' || errMessage.includes('429') || errMessage.includes('quota')) {
    return `You've hit the ${provider} rate limit. Please wait a moment and try again.`
  }
  return 'Sorry, I couldn\'t reach the AI right now. Please try again in a moment.'
}

/**
 * Check if any LLM provider is available (has API key or Nano is ready).
 */
export async function isLLMAvailable(): Promise<boolean> {
  try {
    const mode = await detectCapability()
    if (mode === 'nano') return true
    const claudeKey = await claude.getApiKey()
    if (claudeKey) return true
    const geminiKey = await gemini.getApiKey()
    if (geminiKey) return true
    return false
  } catch {
    return false
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Called on every SPA navigation (URL change).
 *
 * - Destroys the Nano session (page-specific, always reset).
 * - Resets Gemini/Claude conversation history so the next page starts fresh.
 * - Does NOT clear the UserRequirementsStore — that persists across the session
 *   so the concierge remembers the customer's preferences from page to page.
 * - Does NOT clear _cachedMode — the LLM provider stays selected until a key
 *   change or explicit reset.
 */
export function onNavigate(): void {
  nano.destroySession()
  gemini.resetHistory()
  claude.resetHistory()
  // Note: requirementsStore is NOT reset here — it persists for the whole session.
  // It is reset by the user clicking the × on the requirements pill.
  console.debug(`${TAG} onNavigate — LLM sessions reset (requirements preserved)`)
}
