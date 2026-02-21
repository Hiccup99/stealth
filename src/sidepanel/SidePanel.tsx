import { useState } from "preact/hooks";

type Message = { role: "user" | "assistant"; text: string };

export function SidePanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hi! I'm your Wakefit Showroom Associate. Ask me anything about this product — specs, dimensions, trial period, or how it compares to alternatives.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id!, {
        type: "QUERY",
        payload: text,
      });
      setMessages((m) => [...m, { role: "assistant", text: response?.answer ?? "I couldn't find an answer." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="flex h-screen flex-col bg-gray-50">
      <header class="flex items-center gap-2 bg-wakefit-primary px-4 py-3 text-white shadow">
        <div class="h-7 w-7 rounded-full bg-white/20" />
        <div>
          <p class="text-sm font-semibold">Wakefit Associate</p>
          <p class="text-xs opacity-80">AI Showroom Guide</p>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.map((msg, i) => (
          <div key={i} class={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              class={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                msg.role === "user"
                  ? "bg-wakefit-primary text-white rounded-br-sm"
                  : "bg-white text-gray-800 rounded-bl-sm"
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div class="flex justify-start">
            <div class="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-gray-400 shadow-sm">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div class="border-t border-gray-200 bg-white p-3 flex gap-2">
        <input
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about specs, dimensions, trial…"
          class="flex-1 rounded-full border border-gray-200 px-4 py-2 text-sm focus:border-wakefit-primary focus:outline-none"
        />
        <button
          onClick={handleSend}
          disabled={loading}
          class="rounded-full bg-wakefit-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          Send
        </button>
      </div>
    </div>
  );
}
