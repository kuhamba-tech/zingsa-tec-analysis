"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getAdvisoryCentre,
  getAdvisoryCentreHistory,
  postAdvisoryCentreAction,
  type AdvisoryCentreAssessment,
} from "@/lib/api";
import { PUBLIC_SITE_ORIGIN } from "@/lib/advisoryShare";
import styles from "./AdvisoryCentreClient.module.css";

function levelClass(level: string): string {
  if (level === "RED") return styles.levelRed;
  if (level === "ORANGE") return styles.levelOrange;
  if (level === "YELLOW") return styles.levelYellow;
  return styles.levelGreen;
}

function badgeClass(level: string): string {
  if (level === "RED") return styles.badgeRED;
  if (level === "ORANGE") return styles.badgeORANGE;
  if (level === "YELLOW") return styles.badgeYELLOW;
  return styles.badgeGREEN;
}

function fmt(value: number | string | null | undefined, digits = 1, unit = ""): string {
  if (value == null || value === "") return "Unavailable";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
  }
  return String(value);
}

export default function AdvisoryCentreClient() {
  const [assessment, setAssessment] = useState<AdvisoryCentreAssessment | null>(null);
  const [history, setHistory] = useState<
    Array<{ advisory_id: string; issued_utc: string; level: string; state: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (persist = false) => {
    setBusy(true);
    setError(null);
    try {
      const [current, hist] = await Promise.all([
        getAdvisoryCentre(persist),
        getAdvisoryCentreHistory(30),
      ]);
      setAssessment(current);
      setHistory(hist.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(false), 120_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function saveDraft() {
    setMessage(null);
    await load(true);
    setMessage("Draft assessment archived (if database is available).");
  }

  async function runAction(action: "approve" | "publish" | "withdraw") {
    if (!assessment) return;
    setMessage(null);
    try {
      const result = await postAdvisoryCentreAction(
        action,
        assessment.advisory_id,
        adminKey.trim() || undefined,
        "scientific_reviewer",
      );
      setMessage(`${action} → ${result.state}`);
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function copyStatement() {
    if (!assessment?.statement?.plain_text) return;
    void import("@/lib/safeClipboard").then(({ safeClipboardWrite }) => {
      void safeClipboardWrite(assessment.statement.plain_text);
      setMessage("Advisory text copied.");
    });
  }

  function shareWhatsApp() {
    if (!assessment?.statement?.plain_text) return;
    const url = `https://wa.me/?text=${encodeURIComponent(assessment.statement.plain_text.slice(0, 1500))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareFacebook() {
    const page = `${PUBLIC_SITE_ORIGIN}/space-weather/advisory-centre/`;
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(page)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  function downloadText() {
    if (!assessment?.statement?.plain_text) return;
    const blob = new Blob([assessment.statement.plain_text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${assessment.advisory_id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPdf() {
    if (!assessment) return;
    setMessage(null);
    try {
      const { downloadAdvisoryCentrePdf } = await import("@/lib/reportPdf");
      await downloadAdvisoryCentrePdf(assessment);
      setMessage("Advisory PDF downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const obs = assessment?.observations || {};

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>ZINGSA / Space weather intelligence</span>
          <h1>Advisory Centre</h1>
          <p>
            Operational decision-support for ZINGSA. Global geomagnetic hazard and Zimbabwe GNSS reliability
            are assessed as separate tracks. Solar-wind speed alone never confirms a geomagnetic storm.
          </p>
        </div>
        <Link className={styles.contextLink} href="/space-weather/">
          View live space weather <span aria-hidden="true">{"\u2197"}</span>
        </Link>
      </header>

      {error ? <div className="banner banner-warn">{error}</div> : null}
      {message ? <div className="banner banner-info">{message}</div> : null}
      {busy && !assessment ? <div className="banner banner-info">Assessing live conditions…</div> : null}

      {assessment ? (
        <>
          <div className={styles.hero}>
            <section className={`${styles.levelCard} ${levelClass(assessment.advisory_level)}`} aria-live="polite">
              <span className={styles.levelCode}>
                Current advisory level · {assessment.advisory_level}
              </span>
              <h3 className={styles.levelTitle}>{assessment.advisory_label}</h3>
              <p className={styles.meta}>
                {assessment.statement.status_line}
                <br />
                Issued {assessment.issued_utc} · {assessment.issued_cat}
                <br />
                Reference {assessment.advisory_id}
                <br />
                Confidence: {assessment.confidence.label} — {assessment.confidence.rationale}
              </p>
              <p className={styles.meta} style={{ marginTop: "0.75rem" }}>{assessment.statement.body}</p>
              <div className={styles.actions}>
                <button type="button" className="btn btn-primary" onClick={() => void load(false)} disabled={busy}>
                  Refresh assessment
                </button>
                <button type="button" className="btn" onClick={() => void saveDraft()}>
                  Save draft
                </button>
                <button type="button" className="btn" onClick={copyStatement}>
                  Copy advisory
                </button>
                <button type="button" className="btn" onClick={downloadText}>
                  Download TXT
                </button>
                <button type="button" className="btn" onClick={() => void downloadPdf()}>
                  Download PDF
                </button>
                <button type="button" className="btn" onClick={shareWhatsApp}>
                  WhatsApp share link
                </button>
                <button type="button" className="btn" onClick={shareFacebook}>
                  Facebook share link
                </button>
              </div>
            </section>

            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Separated indicators</h3>
              <p className={styles.meta}>{assessment.separation.note}</p>
              <ul className={styles.list}>
                <li>
                  Global geomagnetic:{" "}
                  <span className={`${styles.badge} ${badgeClass(assessment.separation.global_geomagnetic_level)}`}>
                    {assessment.separation.global_geomagnetic_level}
                  </span>
                  {assessment.tracks.geomagnetic.g_scale?.code
                    ? ` · NOAA ${assessment.tracks.geomagnetic.g_scale.code}`
                    : ""}
                </li>
                <li>
                  Zimbabwe GNSS reliability:{" "}
                  <span className={`${styles.badge} ${badgeClass(assessment.separation.zimbabwe_gnss_level)}`}>
                    {assessment.separation.zimbabwe_gnss_level}
                  </span>
                </li>
                <li>
                  Solar-wind / IMF watch:{" "}
                  <span className={`${styles.badge} ${badgeClass(assessment.separation.solar_watch_level)}`}>
                    {assessment.separation.solar_watch_level}
                  </span>
                </li>
              </ul>
              <p className={styles.meta} style={{ marginTop: "0.75rem" }}>
                {assessment.forecast_note}
              </p>
              <p className={styles.meta}>Next review: {assessment.next_review_utc || "—"}</p>
            </section>
          </div>

          <h2 className={styles.sectionTitle}>Monitoring tracks</h2>
          <div className={styles.grid}>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Solar wind monitoring</h3>
              <p className={styles.meta}>
                Speed {fmt(obs.plasma_speed as number | null, 0, "km/s")} · Density{" "}
                {fmt(obs.density as number | null, 1, "cm⁻³")} · Bt {fmt(obs.bt as number | null, 1, "nT")} · Bz{" "}
                {fmt(obs.bz as number | null, 1, "nT")}
              </p>
              <ul className={styles.list}>
                {assessment.tracks.solar_watch.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Geomagnetic storm monitoring</h3>
              <p className={styles.meta}>
                Observed Kp {fmt(obs.kp as number | null, 1)} · Dst {fmt(obs.dst as number | null, 0, "nT")}
              </p>
              <ul className={styles.list}>
                {assessment.tracks.geomagnetic.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Zimbabwe ionosphere / GNSS</h3>
              <p className={styles.meta}>
                VTEC {fmt(obs.mean_vtec as number | null, 1, "TECU")} · S4 {fmt(obs.s4 as number | null, 2)} · Risk{" "}
                {fmt(obs.gnss_risk as string | null)}
              </p>
              <ul className={styles.list}>
                {assessment.tracks.zimbabwe_gnss.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Stakeholder impact assessment</h3>
            <div className={styles.grid}>
              {assessment.stakeholders.map((item) => (
                <article key={item.id}>
                  <h4>{item.title}</h4>
                  <p className={styles.meta} style={{ marginTop: "0.35rem" }}>{item.advice}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Automated advisory statement</h3>
            <pre className={styles.statement}>{assessment.statement.plain_text}</pre>
          </section>

          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Scientific approval / publication</h3>
            <p className={styles.meta}>
              Drafts can be archived automatically. Public release of new or escalated advisories requires
              scientific approval (admin key). Delivery to WhatsApp/Facebook is via share links unless a
              confirmed broadcast API delivery is recorded separately.
            </p>
            <div className={styles.actions}>
              <input
                className="form-input"
                type="password"
                placeholder="Admin key (X-Broadcast-Admin-Key)"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                style={{ minWidth: "16rem" }}
              />
              <button type="button" className="btn" onClick={() => void runAction("approve")}>
                Approve
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void runAction("publish")}>
                Publish
              </button>
              <button type="button" className="btn" onClick={() => void runAction("withdraw")}>
                Withdraw
              </button>
              <Link className="btn" href="/storm-watch/">
                Open Alerts Centre
              </Link>
              <Link className="btn" href="/space-weather/">
                Live Space Weather
              </Link>
            </div>
          </section>

          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Advisory history</h3>
            {history.length === 0 ? (
              <p className={styles.meta}>No archived advisories yet. Use Save draft after an assessment.</p>
            ) : (
              history.map((item) => (
                <div key={item.advisory_id} className={styles.historyItem}>
                  <span className={`${styles.badge} ${badgeClass(item.level)}`}>{item.level}</span>
                  {item.advisory_id} · {item.issued_utc} · state {item.state}
                </div>
              ))
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
