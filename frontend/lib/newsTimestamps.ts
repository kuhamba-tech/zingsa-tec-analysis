/** Source observations and generated copy always carry separate timestamps. */
export function formatNewsTime(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const stamp = new Date(value);
  if (!Number.isFinite(stamp.getTime())) return null;
  const format = (timeZone: string, withDate: boolean) => new Intl.DateTimeFormat("en-GB", {
    timeZone, ...(withDate ? { day: "2-digit" as const, month: "short" as const, year: "numeric" as const } : {}),
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(stamp).replace(" at ", ", ");
  const day = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(stamp);
  return `${format("Africa/Harare", true)} CAT · ${format("UTC", day("UTC") !== day("Africa/Harare"))} UTC`;
}

export function newsTimeLines(observed: string | null, generated: string | null, checked: string | null = null): string[] {
  const lines = [`Data observed: ${formatNewsTime(observed) ?? "Unavailable"}`];
  if (!observed && checked) lines.push(`Data checked: ${formatNewsTime(checked) ?? "Unavailable"}`);
  lines.push(`Brief generated: ${formatNewsTime(generated) ?? "Unavailable"}`);
  return lines;
}

export function newsTimeFields(observed: number | null, generated: number | null, checked: number | null = null) {
  const iso = (value: number | null) => value != null && Number.isFinite(value) ? new Date(value).toISOString() : null;
  return { dataObservedAt: iso(observed), briefGeneratedAt: iso(generated), dataCheckedAt: iso(checked) };
}
