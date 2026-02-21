import { useState } from "preact/hooks";

export function Popup() {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await chrome.storage.sync.set({ apiKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div class="flex w-72 flex-col gap-4 p-4">
      <div class="flex items-center gap-2">
        <div class="h-8 w-8 rounded-full bg-wakefit-primary" />
        <div>
          <p class="text-sm font-semibold text-gray-900">Wakefit Associate</p>
          <p class="text-xs text-gray-500">AI Showroom Guide</p>
        </div>
      </div>

      <hr class="border-gray-100" />

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-600" for="api-key">
          Gemini API Key (fallback)
        </label>
        <input
          id="api-key"
          type="password"
          value={apiKey}
          onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
          placeholder="AIza..."
          class="rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-wakefit-primary focus:outline-none"
        />
        <p class="text-xs text-gray-400">Used when Gemini Nano is unavailable.</p>
      </div>

      <button
        onClick={handleSave}
        class="rounded-md bg-wakefit-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 active:scale-95 transition-all"
      >
        {saved ? "✓ Saved" : "Save"}
      </button>

      <p class="text-center text-xs text-gray-400">
        Visit wakefit.co to activate the Associate
      </p>
    </div>
  );
}
