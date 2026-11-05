"use client";

import { useState } from "react";
import {
  facebookShareUrl,
  whatsAppShareUrl,
  type AdvisoryCard,
} from "@/lib/advisoryShare";
import { safeClipboardWrite } from "@/lib/safeClipboard";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function downloadCard(card: AdvisoryCard) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#071422";
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = "#0c4a6e";
  ctx.fillRect(0, 0, 1200, 78);
  ctx.fillStyle = "#e8f1f8";
  ctx.font = "700 28px sans-serif";
  ctx.fillText("ZINGSA Navigation News", 40, 48);
  ctx.font = "24px sans-serif";
  ctx.fillStyle =
    card.severity === "Warning" ? "#f59e0b" : card.severity === "Watch" ? "#fbbf24" : card.severity === "Unavailable" ? "#94a3b8" : "#34d399";
  ctx.fillText(card.severity, 1160 - ctx.measureText(card.severity).width, 48);
  ctx.fillStyle = "#e8f1f8";
  ctx.font = "700 36px sans-serif";
  ctx.fillText(card.title, 40, 130);
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`${card.category} · ${card.publishedLabel}`, 40, 168);
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#e8f1f8";
  let y = 214;
  for (const indicator of card.indicators) {
    const lines = wrap(ctx, indicator, 1100);
    for (const line of lines) {
      if (y > 540) break;
      ctx.fillText(line, 40, y);
      y += 28;
    }
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = "18px sans-serif";
  ctx.fillText(card.url, 40, 590);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `zingsa-navigation-news-${card.id}.png`;
  link.click();
}

export default function AdvisoryShareBar({ card }: { card: AdvisoryCard }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);

  async function shareNative() {
    if (typeof navigator === "undefined" || !navigator.share) {
      setNotice("This browser has no share sheet. Use WhatsApp, Facebook, or Copy Advisory.");
      return;
    }
    try {
      await navigator.share({ title: card.title, text: card.shareText, url: card.url });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setNotice("The share sheet did not open. Use WhatsApp or Copy Advisory.");
    }
  }

  async function copyAdvisory() {
    const ok = await safeClipboardWrite(card.shareText);
    setShowText(!ok);
    setNotice(ok ? "Advisory copied." : "Copy was blocked. Select the advisory text below.");
  }

  async function subscribe(event: React.FormEvent) {
    event.preventDefault();
    if (!consent) {
      setNotice("Tick the consent box before subscribing. No number is saved without it.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/navigation-news/subscribe/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          consent,
          audience: card.id,
          preferences: ["geomagnetic", "tec", "gnss"],
        }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setNotice(
        body?.message ||
          "WhatsApp alerts are not switched on. This number was not saved and no message will be sent.",
      );
      if (res.ok) {
        setPhone("");
        setConsent(false);
        setSubscribeOpen(false);
      }
    } catch {
      setNotice("The subscription service did not respond. This number was not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="advisory-share">
      <p className="advisory-share-note">
        Sharing opens your own WhatsApp or Facebook. It does not post to the ZINGSA Page, and it does not add an RTK percentage or a regional forecast.
      </p>
      <div className="advisory-share-actions">
        <button type="button" className="gnwi-copy-btn" onClick={shareNative}>
          Share
        </button>
        <a className="gnwi-copy-btn" href={whatsAppShareUrl(card.shareText)} target="_blank" rel="noopener noreferrer">
          Share on WhatsApp
        </a>
        <a className="gnwi-copy-btn" href={facebookShareUrl(card.url)} target="_blank" rel="noopener noreferrer">
          Share on Facebook
        </a>
        <button type="button" className="gnwi-copy-btn" onClick={copyAdvisory}>
          Copy Advisory
        </button>
        <button type="button" className="gnwi-copy-btn" onClick={() => downloadCard(card)}>
          Download Advisory as PNG
        </button>
        <button type="button" className="gnwi-copy-btn" onClick={() => setSubscribeOpen((open) => !open)}>
          Subscribe to Alerts
        </button>
      </div>
      {subscribeOpen && (
        <form className="advisory-subscribe" onSubmit={subscribe}>
          <p>
            WhatsApp Business alerts are not being sent. A number is kept only after ZINGSA connects an approved template and an administrator turns delivery on.
          </p>
          <label>
            Telephone number, with country code
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="2637…"
              required
            />
          </label>
          <label className="advisory-subscribe-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I agree to receive ZINGSA navigation alerts on this number, and I can unsubscribe later.
          </label>
          <button type="submit" className="gnwi-copy-btn" disabled={pending}>
            {pending ? "Checking…" : "Submit opt-in"}
          </button>
        </form>
      )}
      {notice && <p className="advisory-share-notice">{notice}</p>}
      {showText && (
        <textarea className="advisory-share-text" readOnly value={card.shareText} aria-label="Advisory text" />
      )}
    </div>
  );
}
