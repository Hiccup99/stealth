/**
 * gemini-nano.ts — Chrome Built-in AI (Prompt API) provider
 *
 * Constraints vs. cloud models:
 *  • ~4 K token context window  → system prompt must be very concise
 *  • No function calling         → use structured plain-text output we parse
 *  • Fresh session per query     → destroy() to free GPU/NPU memory
 *  • Low temperature + topK      → more deterministic, less hallucination
 *
 * Response wire format (lines-based, not JSON, for reliability):
 *   MESSAGE: <text shown in chat>
 *   ACTIONS: [{"type":"scroll_to","target":"specifications"}]
 */

import type { ProductPageData } from '../content/modules/page-scanner'
import type { AgentAction } from '../content/modules/action-executor'
import { buildSystemPrompt } from './prompts/system-prompt'
import { buildContextPrompt } from './context-builder'

type ProviderResponse = { message: string; actions: AgentAction[] }

const TAG = '[Wakefit Copilot · gemini-nano]'

// ── Response parser ───────────────────────────────────────────────────────────
// Parses the MESSAGE / ACTIONS line-prefixed format.
// Falls back gracefully if the model doesn't follow the format exactly.

const MESSAGE_RE = /^MESSAGE:\s*/im
const ACTIONS_RE = /^ACTIONS:\s*/im

function parseResponse(raw: string): ProviderResponse {
  const msgMatch     = MESSAGE_RE.exec(raw)
  const actionsMatch = ACTIONS_RE.exec(raw)

  // ── Extract message text ─────────────────────────────────────────────────
  let message: string
  if (msgMatch) {
    const start = msgMatch.index + msgMatch[0].length
    const end   = actionsMatch ? actionsMatch.index : raw.length
    message = raw.slice(start, end).trim()
  } else {
    // No MESSAGE: label — treat everything before ACTIONS: (or whole string) as message
    message = actionsMatch
      ? raw.slice(0, actionsMatch.index).trim()
      : raw.trim()
  }

  // ── Extract and parse actions JSON ───────────────────────────────────────
  let actions: AgentAction[] = []
  if (actionsMatch) {
    const jsonRaw = raw.slice(actionsMatch.index + actionsMatch[0].length).trim()

    // Find the start of the JSON array (model might include text before '[')
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

// ── Public API ────────────────────────────────────────────────────────────────

export async function query(
  userMessage: string,
  pageData:    ProductPageData,
): Promise<ProviderResponse> {
  if (!window.ai?.languageModel) {
    throw new Error('Gemini Nano is not available in this browser')
  }

  const systemPrompt   = buildSystemPrompt(pageData)
  const contextPrompt  = buildContextPrompt(pageData, userMessage)

  console.debug(`${TAG} creating session — system prompt: ${systemPrompt.length} chars`)

  const session = await window.ai.languageModel.create({
    systemPrompt,
    temperature: 0.3,
    topK:        3,
  })

  console.debug(`${TAG} session ready — ${session.tokensLeft}/${session.maxTokens} tokens left`)

  let raw = ''
  try {
    raw = await session.prompt(contextPrompt)
    console.debug(`${TAG} raw response:`, raw.slice(0, 300))
  } finally {
    // Always free GPU/NPU memory — sessions are not reused
    session.destroy()
    console.debug(`${TAG} session destroyed`)
  }

  return parseResponse(raw)
}

/** No-op — Nano uses per-query sessions; kept for router interface parity. */
export function destroySession(): void {
  console.debug(`${TAG} destroySession() called (no cached session to clear)`)
}
