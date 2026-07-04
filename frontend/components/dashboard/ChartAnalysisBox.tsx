"use client";

import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";

export default function ChartAnalysisBox({
  block,
  title = "What this chart tells you",
}: {
  block: ChartAnalysisBlock;
  title?: string;
}) {
  if (!block.lead && !block.bullets.length) return null;
  return (
    <div
      className="chart-analysis"
      style={{
        marginTop: "0.85rem",
        padding: "0.75rem 0.9rem",
        borderLeft: "3px solid var(--accent)",
        background: "rgba(22, 139, 210, 0.08)",
        borderRadius: "0 6px 6px 0",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: "0.35rem" }}>{title}</div>
      {block.lead && (
        <p style={{ margin: "0 0 0.55rem", fontSize: "0.84rem", lineHeight: 1.5, color: "var(--text)" }}>{block.lead}</p>
      )}
      {block.bullets.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.55 }}>
          {block.bullets.map((text, i) => (
            <li key={i} style={{ marginBottom: "0.35rem" }}>
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
