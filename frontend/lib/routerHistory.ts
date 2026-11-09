/** Cosmetic URL changes must preserve the initialized App Router history entry. */
export function replaceHistoryUrl(url: string): boolean {
  const state = window.history.state;
  // Next 16 marks its initialized entries with __NA. Before that entry exists,
  // leave the URL alone rather than dispatching a restore during hydration.
  if (!state || state.__NA !== true) return false;
  window.history.replaceState(state, "", url);
  return true;
}
