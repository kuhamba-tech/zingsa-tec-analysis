"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./CalendarDatePicker.module.css";

function parts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month: month - 1, day };
}

export default function CalendarDatePicker({ value, onChange, label, min }: {
  value: string; onChange: (value: string) => void; label: string; min?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [view, setView] = useState(() => parts(value));
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const shift = (amount: number) => {
    const date = new Date(Date.UTC(view.year, view.month + amount, 1));
    setView({ year: date.getUTCFullYear(), month: date.getUTCMonth(), day: 1 });
  };
  const count = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(view.year, view.month, 1)).getUTCDay() + 6) % 7;
  const month = new Date(Date.UTC(view.year, view.month, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const display = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return <div ref={root} className={styles.root} onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className={styles.trigger} aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => {
      if (!open) { setDraft(value); setView(parts(value)); }
      setOpen(!open);
    }}><span>{display(value)}</span><span aria-hidden="true">▦</span></button>
    {open && <div id={id} role="dialog" aria-label={`${label} calendar`} className={styles.calendar}>
      <div className={styles.header}>
        <button autoFocus type="button" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
        <strong aria-live="polite">{month}</strong>
        <button type="button" aria-label="Next month" onClick={() => shift(1)}>›</button>
      </div>
      <div className={styles.grid}>
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day => <span className={styles.weekday} key={day}>{day}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const day = i + 1;
          const date = `${view.year}-${String(view.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return <button key={date} type="button" aria-label={date} aria-pressed={draft === date} disabled={!!min && date < min} className={draft === date ? styles.selected : undefined} onClick={() => setDraft(date)}>{day}</button>;
        })}
      </div>
      <div className={styles.footer}>
        <span>{display(draft)}</span>
        <button type="button" disabled={!!min && draft < min} onClick={() => { onChange(draft); setOpen(false); trigger.current?.focus(); }}>Set Date</button>
      </div>
    </div>}
  </div>;
}
