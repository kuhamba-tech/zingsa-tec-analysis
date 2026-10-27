/**
 * Clipboard helpers that never throw into Next's error overlay.
 * Browsers reject writeText when the document is not focused or the page is not secure.
 */

function isClipboardNotAllowedError(message: string, reason?: unknown): boolean {
  if (!message && reason && typeof reason === "object" && "name" in reason) {
    message = String((reason as { name?: string }).name ?? "");
  }

  return /clipboard|Document is not focused|NotAllowedError|writeText|Permission denied/i.test(message);
}

export async function safeClipboardWrite(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (typeof document !== "undefined") {
    if (!document.hasFocus() || document.visibilityState === "hidden") return false;
  }
  if (!window.isSecureContext) return false;
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (isClipboardNotAllowedError(message, err)) return false;
    return false;
  }
}

/** Suppress noisy browser rejections and uncaught errors that Next surfaces as runtime overlays. */
export function installClientRejectionGuards(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const suppressIfKnown = (message: string, reason?: unknown) => {
    if (!message && reason && typeof reason === "object" && "name" in reason) {
      message = String((reason as { name?: string }).name ?? "");
    }

    if (
      /clipboard|Document is not focused|NotAllowedError|writeText|Permission denied|Loading chunk|ChunkLoadError/i.test(message)
    ) {
      return true;
    }

    return false;
  };

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
    if (suppressIfKnown(message, reason)) {
      event.preventDefault();
    }
  };

  const onError = (event: ErrorEvent) => {
    const message = event.message || (event.error instanceof Error ? event.error.message : "");
    if (suppressIfKnown(message, event.error)) {
      event.preventDefault();
      return;
    }
  };

  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
  };
}
