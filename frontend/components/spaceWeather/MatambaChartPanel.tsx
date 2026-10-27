"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import type { ChartAnalysisBlock } from "@/lib/multiSourceChartAnalysis";

export default function MatambaChartPanel({
  analysis,
  label,
  children,
}: {
  analysis: ChartAnalysisBlock;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((value) => !value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <div
      className={`matamba-chart-panel${open ? " is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${label}. ${open ? "Hide" : "Show"} the Matamba and Danskin explanation.`}
      onClick={toggle}
      onKeyDown={onKeyDown}
    >
      {children}
      <div className="matamba-chart-panel-hint">
        {open ? "Hide Matamba explanation" : "Click the graph for the Matamba explanation"}
      </div>
      {open && (
        <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <ChartAnalysisBox block={analysis} title="Matamba and Danskin (2022)" />
        </div>
      )}
    </div>
  );
}
