import { isGeminiNanoAvailable, queryOnDevice } from "./geminiNano";
import { queryGeminiFlash } from "./geminiFlash";

export async function query(prompt: string): Promise<string> {
  if (await isGeminiNanoAvailable()) {
    return queryOnDevice(prompt);
  }

  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) throw new Error("No Gemini API key configured and Gemini Nano is unavailable.");
  return queryGeminiFlash(prompt, apiKey);
}
