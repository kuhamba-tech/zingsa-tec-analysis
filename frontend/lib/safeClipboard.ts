/**
 * Clipboard helpers that never throw into Next's error overlay.
 * Browsers reject writeText when the document is not focused.
 */

export async function safeClipboardWrite(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (typeof document !== "undefined" && !document.hasFocus()) return false;
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Suppress noisy browser rejections that Next surfaces as runtime overlays. */
export function installClientRejectionGuards(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof Event) {
      event.preventDefault();
      return;
    }
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "";
    if (
      /clipboard|Document is not focused|NotAllowedError|writeText/i.test(message) ||
      (reason && typeof reason === "object" && "name" in reason && (reason as { name?: string }).name === "NotAllowedError")
    ) {
      event.preventDefault();
    }
  };

  window.addEventListener("unhandledrejection", onRejection);
  return () => window.removeEventListener("unhandledrejection", onRejection);
}
