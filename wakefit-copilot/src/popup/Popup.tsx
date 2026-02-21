import { useState, useEffect } from 'preact/hooks'

export function Popup() {
  const [claudeKey, setClaudeKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [saved, setSaved]         = useState(false)

  useEffect(() => {
    chrome.storage.local.get(['claudeApiKey', 'geminiApiKey']).then((result) => {
      setClaudeKey((result['claudeApiKey'] as string | undefined) ?? '')
      setGeminiKey((result['geminiApiKey'] as string | undefined) ?? '')
    })
  }, [])

  async function handleSave() {
    await chrome.storage.local.set({
      claudeApiKey: claudeKey.trim() || undefined,
      geminiApiKey: geminiKey.trim() || undefined,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const canSave = claudeKey.trim() || geminiKey.trim()

  return (
    <div class="flex w-72 flex-col gap-4 p-4">
      <div class="flex items-center gap-2">
        <div class="h-8 w-8 rounded-full bg-wakefit-primary" />
        <div>
          <p class="text-sm font-semibold text-gray-900">Wakefit Copilot</p>
          <p class="text-xs text-gray-500">AI Showroom Guide</p>
        </div>
      </div>

      <hr class="border-gray-100" />

      {/* Claude — preferred */}
      <div class="flex flex-col gap-1">
        <label class="flex items-center gap-1.5 text-xs font-medium text-gray-600" for="claude-key">
          Claude API Key
          <span class="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">preferred</span>
        </label>
        <input
          id="claude-key"
          type="password"
          value={claudeKey}
          onInput={(e) => setClaudeKey((e.target as HTMLInputElement).value)}
          placeholder="sk-ant-…"
          class="rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-violet-400 focus:outline-none"
        />
        <p class="text-xs text-gray-400">Get a key at <a href="https://console.anthropic.com" target="_blank" class="underline">console.anthropic.com</a></p>
      </div>

      {/* Gemini — fallback */}
      <div class="flex flex-col gap-1">
        <label class="flex items-center gap-1.5 text-xs font-medium text-gray-600" for="gemini-key">
          Gemini API Key
          <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">fallback</span>
        </label>
        <input
          id="gemini-key"
          type="password"
          value={geminiKey}
          onInput={(e) => setGeminiKey((e.target as HTMLInputElement).value)}
          placeholder="AIza…"
          class="rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-wakefit-primary focus:outline-none"
        />
        <p class="text-xs text-gray-400">Get a key at <a href="https://aistudio.google.com" target="_blank" class="underline">aistudio.google.com</a></p>
      </div>

      <button
        onClick={handleSave}
        disabled={!canSave}
        class="rounded-md bg-wakefit-primary px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
      >
        {saved ? '✓ Saved' : 'Save'}
      </button>

      <p class="text-center text-xs text-gray-400">Visit wakefit.co to activate</p>
    </div>
  )
}
