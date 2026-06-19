"use client";
import { useState } from "react";
import { sendChat } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

const SUGGESTIONS = [
  "What is the current ionospheric condition over Zimbabwe?",
  "How does the Kp index affect GNSS positioning accuracy?",
  "Explain the equatorial ionospheric anomaly.",
  "What causes TEC enhancement during geomagnetic storms?",
];

export default function AiAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(text: string) {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await sendChat(next, apiKey || undefined);
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Error: ${e}` }]);
    }
    setLoading(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem", maxWidth: "860px" }}>
      <div>
        <h1 className="page-title">🤖 AI Assistant</h1>
        <p className="page-subtitle">Ask questions about TEC, space weather, and ionospheric science. Powered by Claude.</p>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <label className="metric-label">Anthropic API Key (optional — uses server key if blank)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-…"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)", width: "100%", maxWidth: "400px" }}
        />
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
          If provided, your key is sent to the ZGIIS backend with this request only, forwarded to Anthropic to generate the
          reply, and never stored or logged. Leave blank to use the server&apos;s configured key instead.
        </p>
      </div>

      {/* Suggestions */}
      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn" onClick={() => send(s)} style={{ fontSize: "0.78rem" }}>{s}</button>
          ))}
        </div>
      )}

      {/* Chat history */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", minHeight: "200px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: m.role === "user" ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "80%",
              padding: "0.65rem 1rem",
              borderRadius: m.role === "user" ? "12px 12px 0 12px" : "12px 12px 12px 0",
              background: m.role === "user" ? "var(--accent)" : "var(--surface)",
              border: m.role === "assistant" ? "1px solid var(--border)" : "none",
              color: m.role === "user" ? "#000" : "var(--text)",
              fontSize: "0.88rem",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Claude is thinking…</div>
        )}
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(input))}
          placeholder="Ask about TEC, space weather, GNSS…"
          disabled={loading}
          style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "0.6rem 0.9rem", color: "var(--text)", fontSize: "0.9rem" }}
        />
        <button className="btn btn-primary" onClick={() => send(input)} disabled={loading || !input.trim()}>
          Send
        </button>
        {messages.length > 0 && (
          <button className="btn" onClick={() => setMessages([])}>Clear</button>
        )}
      </div>
    </div>
  );
}
