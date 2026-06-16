"use client";

import { useEffect, useRef } from "react";

type Props = {
  latex: string;
  number: string;
  caption?: string;
};

type KatexApi = {
  render: (tex: string, el: HTMLElement, opts: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    katex?: KatexApi;
  }
}

const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css";
const KATEX_JS = "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js";

let katexLoad: Promise<KatexApi> | null = null;

function loadKatex(): Promise<KatexApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("KaTeX requires a browser"));
  }
  if (window.katex) return Promise.resolve(window.katex);
  if (katexLoad) return katexLoad;

  katexLoad = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${KATEX_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = KATEX_CSS;
      document.head.appendChild(link);
    }

    const existing = document.querySelector(`script[src="${KATEX_JS}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.katex) resolve(window.katex);
        else reject(new Error("KaTeX failed to load"));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = KATEX_JS;
    script.async = true;
    script.onload = () => {
      if (window.katex) resolve(window.katex);
      else reject(new Error("KaTeX failed to load"));
    };
    script.onerror = () => reject(new Error("KaTeX script error"));
    document.head.appendChild(script);
  });

  return katexLoad;
}

export default function LatexEquation({ latex, number, caption }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const body = `${latex.trim()}\n\\tag{${number}}`;
    let cancelled = false;

    loadKatex()
      .then((katex) => {
        if (cancelled || !ref.current) return;
        katex.render(body, ref.current, {
          displayMode: true,
          throwOnError: false,
          trust: true,
          strict: "ignore",
        });
      })
      .catch(() => {
        if (!cancelled && ref.current) ref.current.textContent = body;
      });

    return () => {
      cancelled = true;
    };
  }, [latex, number]);

  return (
    <div className="vtec-eq-wrap">
      <div ref={ref} className="vtec-eq-math" />
      {caption ? <div className="vtec-eq-caption">{caption}</div> : null}
    </div>
  );
}
