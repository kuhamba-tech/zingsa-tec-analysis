"use client";

import { useEffect, useState } from "react";
import { getLiveVtecHealth } from "@/lib/api";
import { liveVtecHealthBannerText } from "@/lib/liveVtecLabels";
import type { LiveVtecHealth } from "@/lib/types";

const REFRESH_MS = 45_000;

type Props = {
  className?: string;
};

export default function LiveVtecHealthBanner({ className }: Props) {
  const [health, setHealth] = useState<LiveVtecHealth | null>(null);
  const [status, setStatus] = useState<"pending" | "ok" | "down">("pending");

  useEffect(() => {
    let cancelled = false;
    const load = async (background = false) => {
      if (!background) setStatus("pending");
      try {
        const payload = await getLiveVtecHealth();
        if (cancelled) return;
        setHealth(payload);
        setStatus("ok");
      } catch {
        if (cancelled) return;
        if (!background) {
          setHealth(null);
          setStatus("down");
        }
      }
    };
    void load(false);
    const id = window.setInterval(() => void load(true), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (status === "pending" && !health) {
    return (
      <div className={`banner banner-info ${className ?? ""}`.trim()} role="status">
        Checking live VTEC pipeline…
      </div>
    );
  }

  if (status === "down" && !health) {
    return (
      <div className={`banner banner-warn ${className ?? ""}`.trim()} role="status">
        Cannot reach live VTEC health API — is FastAPI running on :8000?
      </div>
    );
  }

  if (!health) return null;

  const { tone, text } = liveVtecHealthBannerText(health);
  const bannerClass =
    tone === "ok" ? "banner-info" : tone === "alert" ? "banner-alert" : "banner-warn";

  return (
    <div className={`banner ${bannerClass} ${className ?? ""}`.trim()} role="status">
      {text}
      {health.db_backend ? (
        <span style={{ opacity: 0.85 }}>
          {" "}
          · DB {health.db_backend}
          {health.collector_running ? " · collector up" : health.collector_expected ? " · collector down" : ""}
        </span>
      ) : null}
    </div>
  );
}
