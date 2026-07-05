"use client";
import { useState } from "react";
import { sendChat } from "@/lib/api";
import type { ChatContextSummary, ChatMessage } from "@/lib/types";

const SUGGESTIONS = [
  "What is the current ionospheric condition over Zimbabwe?",
  "How does the Kp index affect GNSS positioning accuracy?",
  "Explain the equatorial ionospheric anomaly.",
  "What causes TEC enhancement during geomagnetic storms?",
  "What does a VTEC of 35 TECU mean for RTK accuracy?",
  "Why is TEC highest around 14:00 local time?",
  "What Kp level causes RTK to fail?",
  "Explain STEC vs VTEC and the mapping function.",
];

function formatAssistantText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
}

function ContextPanel({ context }: { context: ChatContextSummary | null | undefined }) {
  if (!context?.lines?.length) {
    return (
      <div className="banner banner-info" style={{ fontSize: "0.82rem" }}>
        No live platform context available yet — answers will use general ionosphere knowledge.
      </div>
    );
  }
  return (
    <div className="card" style={{ fontSize: "0.82rem" }}>
      <div className="metric-label" style={{ marginBottom: "0.5rem" }}>Live context injected into Claude</div>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.6 }}>
        {context.lines.map((line, i) => (
          <li key={i} style={{ color: "var(--text-muted)" }}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AiAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastContext, setLastContext] = useState<ChatContextSummary | null>(null);

  async function send(text: string) {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await sendChat(next);
      setLastContext(res.context ?? null);
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Error: ${e}` }]);
    }
    setLoading(false);
  }

  function exportTranscript() {
    const transcript = messages
      .map((m) => `${m.role === "user" ? "USER" : "TEC AI"}: ${m.content}`)
      .join("\n\n");
    const blob = new Blob([transcript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tec_ai_chat.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-content-narrow">
      <div>
        <h1 className="page-title">🤖 AI Assistant</h1>
        <p className="page-subtitle">
          Ask questions about TEC, space weather, and ionospheric science. Live ZGIIS data is injected into each reply.
        </p>
      </div>

      <ContextPanel context={lastContext} />

      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn" onClick={() => send(s)} style={{ fontSize: "0.78rem" }}>{s}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", minHeight: "200px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div
              style={{
                maxWidth: "80%",
                padding: "0.65rem 1rem",
                borderRadius: m.role === "user" ? "12px 12px 0 12px" : "12px 12px 12px 0",
                background: m.role === "user" ? "var(--accent)" : "var(--surface)",
                border: m.role === "assistant" ? "1px solid var(--border)" : "none",
                color: m.role === "user" ? "#000" : "var(--text)",
                fontSize: "0.88rem",
                lineHeight: 1.55,
                whiteSpace: m.role === "user" ? "pre-wrap" : undefined,
              }}
            >
              {m.role === "assistant" ? (
                <span dangerouslySetInnerHTML={{ __html: formatAssistantText(m.content) }} />
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {loading && <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Claude is thinking…</div>}
      </div>

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
          <>
            <button className="btn" onClick={exportTranscript}>Export</button>
            <button className="btn" onClick={() => { setMessages([]); setLastContext(null); }}>Clear</button>
          </>
        )}
      </div>
    </div>
  );
}
