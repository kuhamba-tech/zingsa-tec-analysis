/** Refresh visible views without overlapping slow requests or polling hidden tabs. */
export function startVisiblePolling(task: () => Promise<void>, intervalMs: number, initialDelayMs = 0) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    if (!stopped && !document.hidden) timer = setTimeout(run, delay);
  };
  const run = async () => {
    timer = undefined;
    if (stopped || running || document.hidden) return;
    running = true;
    try {
      await task();
    } catch {
      // A transient failure must not stop subsequent refreshes.
    } finally {
      running = false;
      schedule(intervalMs);
    }
  };
  const visibilityChanged = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!document.hidden && !running) schedule(0);
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  schedule(initialDelayMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
