/**
 * Type declarations for the Chrome Built-in AI (Prompt API).
 * Spec: https://github.com/explainers-by-googlers/prompt-api
 *
 * These are ambient types — no import needed. `window.ai` is declared below.
 */

interface AILanguageModelCapabilities {
  available: 'readily' | 'after-download' | 'no'
  defaultTopK?:       number
  maxTopK?:           number
  defaultTemperature?: number
}

interface AILanguageModelCreateOptions {
  systemPrompt?:  string
  topK?:          number
  temperature?:   number
  signal?:        AbortSignal
}

interface AILanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>
  clone(options?: { signal?: AbortSignal }): Promise<AILanguageModelSession>
  destroy(): void
  readonly tokensSoFar:  number
  readonly maxTokens:    number
  readonly tokensLeft:   number
}

interface AILanguageModel {
  create(options?: AILanguageModelCreateOptions): Promise<AILanguageModelSession>
  capabilities(): Promise<AILanguageModelCapabilities>
}

interface AI {
  languageModel: AILanguageModel
}

// Extend the global Window interface
interface Window {
  ai?: AI
}
