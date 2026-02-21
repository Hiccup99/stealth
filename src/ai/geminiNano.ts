export interface AIResponse {
  text: string;
  actions: AIAction[];
}

export interface AIAction {
  type: "scroll" | "highlight" | "tooltip" | "navigate";
  target?: string; // CSS selector
  content?: string;
}

export async function isGeminiNanoAvailable(): Promise<boolean> {
  try {
    // Chrome Built-in AI Prompt API (origin trial / canary)
    const ai = (window as unknown as { ai?: { languageModel?: { capabilities: () => Promise<{ available: string }> } } }).ai;
    if (!ai?.languageModel) return false;
    const capabilities = await ai.languageModel.capabilities();
    return capabilities.available !== "no";
  } catch {
    return false;
  }
}

export async function queryOnDevice(prompt: string): Promise<string> {
  const ai = (window as unknown as { ai: { languageModel: { create: () => Promise<{ prompt: (p: string) => Promise<string> }> } } }).ai;
  const session = await ai.languageModel.create();
  return session.prompt(prompt);
}
