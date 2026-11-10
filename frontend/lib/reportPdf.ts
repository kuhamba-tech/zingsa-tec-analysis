/**
 * Client-side PDF report export — works on Vercel frontend without a backend round-trip.
 */
import type {
  AnomalyDay,
  GicReport,
  SpaceWeatherReport,
  StationUptimeAnalysis,
} from "@/lib/types";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 19).replace("T", " ") + " UTC";
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

async function createDoc(title: string, subtitle: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFillColor(6, 13, 26);
  doc.rect(0, 0, 210, 32, "F");
  doc.setTextColor(0, 212, 255);
  doc.setFontSize(16);
  doc.text(title, 105, 14, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(180, 200, 220);
  doc.text(subtitle, 105, 21, { align: "center" });
  doc.text("Zimbabwe GNSS Ionosphere Intelligence System (ZINGSA)", 105, 27, { align: "center" });
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  return doc;
}

async function addTable(
  doc: import("jspdf").jsPDF,
  startY: number,
  head: string[][],
  body: (string | number)[][],
  title?: string,
): Promise<number> {
  const autoTable = (await import("jspdf-autotable")).default;
  if (title) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(title, 14, startY);
    startY += 6;
  }
  autoTable(doc, {
    startY,
    head,
    body,
    theme: "grid",
    headStyles: { fillColor: [30, 58, 95], textColor: [220, 230, 240], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  });
  return (doc as import("jspdf").jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
}

function addFooter(doc: import("jspdf").jsPDF) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC · Page ${i} of ${pageCount}`,
      105,
      290,
      { align: "center" },
    );
  }
}

export async function downloadSpaceWeatherReportPdf(report: SpaceWeatherReport) {
  const doc = await createDoc("Space Weather Report", report.period_label);
  let y = 40;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Window: ${fmtUtc(report.window_start)} → ${fmtUtc(report.window_end)}`, 14, y);
  y += 5;
  doc.text(`Archived records: ${report.sample_count}`, 14, y);
  y += 8;

  const paragraph = (text: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 9);
    const lines: string[] = doc.splitTextToSize(text, 182);
    for (const line of lines) {
      if (y > 276) { doc.addPage(); y = 20; }
      doc.text(line, 14, y);
      y += 4.8;
    }
    y += 3;
  };
  paragraph("Automated scientific assessment / scientist review not recorded");
  paragraph("Assessment at a glance", true);
  paragraph(report.sections?.length ? report.executive_summary : "Structured assessment unavailable. The archived measurements below do not independently establish local impacts.");
  for (const section of report.sections ?? []) {
    if (y > 255) { doc.addPage(); y = 20; }
    paragraph(section.title, true);
    for (const text of section.paragraphs) paragraph(text);
  }
  if (report.references?.length) {
    paragraph("Scientific reference framework", true);
    for (const reference of report.references) paragraph(`${reference.title}: ${reference.url}`);
  }
  if (y > 245) { doc.addPage(); y = 20; }

  if (report.parameters.length) {
    y = await addTable(
      doc,
      y,
      [["Parameter", "Latest archived value", "Archive trend"]],
      report.parameters.map((p) => [
        p.name,
        p.current != null ? `${fmtNum(p.current)}${p.unit ? ` ${p.unit}` : ""}` : "—",
        p.trend,
      ]),
      "Latest archived measurements",
    );
  }

  if (report.gnss_stations.length) {
    y = await addTable(
      doc,
      y,
      [["Station", "Availability %", "RTK note"]],
      report.gnss_stations.slice(0, 30).map((s) => [
        `${(s.station_code ?? "—").toUpperCase()} ${s.station_name ?? ""}`.trim(),
        s.availability_pct != null ? fmtNum(s.availability_pct, 1) : "—",
        s.rtk_note.slice(0, 80),
      ]),
      "CORS service availability (not impact attribution)",
    );
  }

  if (report.charts.labels.length) {
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    y = await addTable(
      doc,
      y,
      [["Time (UTC)", "Kp", "Dst (nT)", "TEC (TECU)"]],
      report.charts.labels.map((label, i) => [
        label,
        fmtNum(report.charts.kp[i], 1),
        fmtNum(report.charts.dst[i], 0),
        fmtNum(report.charts.tec[i], 2),
      ]),
      "Time series snapshot",
    );
  }

  addFooter(doc);
  triggerDownload(doc.output("blob"), `space_weather_${report.period}_report.pdf`);
}

export async function downloadUptimeReportPdf(analysis: StationUptimeAnalysis, scopeLabel: string) {
  const doc = await createDoc("CORS Station Uptime Report", scopeLabel);
  let y = 40;
  doc.setFontSize(9);
  doc.text(`Period: ${analysis.hours} hours · Bucket: ${analysis.bucket_minutes} min`, 14, y);
  y += 5;
  doc.text(
    `Network online: ${fmtNum(analysis.network_online_pct, 1)}% · Outage events: ${analysis.outage_events}`,
    14,
    y,
  );
  y += 8;

  if (analysis.stations.length) {
    y = await addTable(
      doc,
      y,
      [["Station", "Samples", "Online %", "Offline %", "Unknown %"]],
      analysis.stations.map((r) => [
        `${r.station_code.toUpperCase()} — ${r.station_name}`,
        String(r.samples),
        fmtNum(r.online_pct, 1),
        fmtNum(r.offline_pct, 1),
        fmtNum(r.unknown_pct, 1),
      ]),
      "Per-station availability",
    );
  }

  if (analysis.timeline.length) {
    if (y > 230) {
      doc.addPage();
      y = 20;
    }
    y = await addTable(
      doc,
      y,
      [["Time (UTC)", "Online %", "Online", "Offline", "Unknown"]],
      analysis.timeline.map((p) => [
        fmtUtc(p.time),
        fmtNum(p.online_pct, 1),
        String(p.online_count),
        String(p.offline_count),
        String(p.unknown_count),
      ]),
      "Availability timeline",
    );
  }

  const outages = analysis.outage_intervals ?? [];
  if (outages.length) {
    if (y > 230) {
      doc.addPage();
      y = 20;
    }
    await addTable(
      doc,
      y,
      [["Station", "Started (UTC)", "Ended (UTC)", "Duration (min)", "Ongoing"]],
      outages.map((o) => [
        o.station_code.toUpperCase(),
        fmtUtc(o.started_at),
        o.ended_at ? fmtUtc(o.ended_at) : "—",
        fmtNum(o.duration_min, 0),
        o.ongoing ? "Yes" : "No",
      ]),
      "Outage intervals",
    );
  }

  addFooter(doc);
  const scope = analysis.station_code ?? "network";
  triggerDownload(doc.output("blob"), `cors_uptime_${scope}_${analysis.hours}h.pdf`);
}

export async function downloadGicReportPdf(report: GicReport) {
  const doc = await createDoc("GIC Monitor Report", `${report.station_id} · ${report.period_label}`);
  let y = 40;
  doc.setFontSize(9);
  doc.text(`Window: ${fmtUtc(report.window_start)} → ${fmtUtc(report.window_end)}`, 14, y);
  y += 5;
  doc.text(`Samples: ${report.sample_count}`, 14, y);
  y += 8;

  if (report.coverage) {
    y = await addTable(doc, y, [["Observation coverage", "Value"]], [
      ["Stored / valid records", `${report.coverage.records} / ${report.coverage.valid_records}`],
      ["Expected sampling cadence (s)", report.coverage.cadence_seconds == null ? "Unknown" : String(report.coverage.cadence_seconds)],
      ["Missing data (%)", report.coverage.missing_pct == null ? "Unknown; cadence required" : String(report.coverage.missing_pct)],
      ["Duration method", report.duration_method ?? "Observed adjoining intervals only"],
    ], "Data quality and coverage");
  }
  if (report.statistics) {
    const s = report.statistics;
    y = await addTable(
      doc,
      y,
      [["Metric", "Value"]],
      [
        ["Peak |GIC| (A)", fmtNum(s.peak_abs_a, 2)],
        ["Peak time (UTC)", fmtUtc(s.peak_time)],
        ["Mean GIC (A)", fmtNum(s.mean_a, 2)],
        ["Std dev (A)", fmtNum(s.std_a, 2)],
        ["95th percentile |GIC| (A)", fmtNum(s.p95_abs_a, 2)],
        [`Events >= ${report.event_threshold_a ?? 10} A (monitoring)`, String(report.events.length)],
      ],
      "Statistics",
    );
  }

  if (report.band_minutes.length) {
    y = await addTable(
      doc,
      y,
      [["Monitoring category", "Observed minutes", "Samples"]],
      report.band_minutes.map((b) => [b.level, String(b.minutes), String(b.samples)]),
      "Monitoring category occupancy",
    );
  }

  if (report.events.length) {
    if (y > 230) {
      doc.addPage();
      y = 20;
    }
    y = await addTable(
      doc,
      y,
      [["Start (UTC)", "Duration (min)", "Peak (A)", "Band"]],
      report.events.map((e) => [
        fmtUtc(e.start),
        fmtNum(e.duration_min, 0),
        fmtNum(e.peak_gic_a, 2),
        e.level,
      ]),
      "Large-GIC events",
    );
  }

  if (report.interpretation.length) {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Interpretation", 14, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    for (const note of report.interpretation) {
      const lines = doc.splitTextToSize(`• ${note}`, 182);
      for (const line of lines as string[]) {
        if (y > 276) { doc.addPage(); y = 20; }
        doc.text(line, 14, y);
        y += 4.5;
      }
      y += 2;
    }
  }

  addFooter(doc);
  triggerDownload(
    doc.output("blob"),
    `gic_${report.station_id.toLowerCase()}_${report.period}_report.pdf`,
  );
}

export async function downloadAnomalyReportPdf(days: AnomalyDay[], thresholdPct: number) {
  const flagged = days.filter((d) => d.anomaly);
  const doc = await createDoc("TEC Anomaly Report", `${thresholdPct}th percentile threshold`);
  let y = 40;
  doc.setFontSize(9);
  doc.text(`Archive days: ${days.length} · Anomaly days: ${flagged.length}`, 14, y);
  y += 8;

  if (flagged.length) {
    await addTable(
      doc,
      y,
      [["Date", "Mean VTEC", "Threshold", "Kp", "Dst", "Storm", "TEC response"]],
      flagged.slice(0, 50).map((d) => [
        d.date,
        fmtNum(d.mean_vtec, 2),
        fmtNum(d.threshold, 2),
        d.kp != null ? fmtNum(d.kp, 1) : "—",
        d.dst != null ? fmtNum(d.dst, 0) : "—",
        d.storm_flag ? "Yes" : "No",
        (d.tec_response ?? "—").slice(0, 40),
      ]),
      "Flagged anomaly days",
    );
  } else {
    doc.text("No anomaly days in the selected archive range.", 14, y);
  }

  addFooter(doc);
  triggerDownload(doc.output("blob"), `tec_anomalies_${thresholdPct}pct.pdf`);
}

/** ZINGSA Space Weather Advisory Centre statement PDF (measurement-traceable text only). */
export async function downloadAdvisoryCentrePdf(assessment: {
  advisory_id: string;
  issued_utc: string;
  issued_cat: string;
  advisory_level: string;
  advisory_label: string;
  confidence: { label: string; rationale: string };
  statement: { body: string; plain_text?: string; attribution?: string };
  tracks: Record<string, { evidence?: string[] }>;
  stakeholders: { title: string; advice: string }[];
  next_review_utc?: string;
  forecast_note?: string;
}) {
  const doc = await createDoc(
    "Space Weather Advisory",
    `${assessment.advisory_level} — ${assessment.advisory_label}`,
  );
  let y = 40;
  const write = (text: string, bold = false, size = 9) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(text, 182);
    for (const line of lines) {
      if (y > 276) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, 14, y);
      y += bold ? 5.2 : 4.6;
    }
    y += 2.5;
  };

  write(`Reference: ${assessment.advisory_id}`, true, 11);
  write(`Issued: ${fmtUtc(assessment.issued_utc)} · ${assessment.issued_cat}`);
  write(`Status: ${assessment.advisory_level} — ${assessment.advisory_label}`, true, 11);
  write(assessment.statement.body);
  if (assessment.forecast_note) {
    write("Forecast note", true);
    write(assessment.forecast_note);
  }
  write("Evidence (observed tracks)", true);
  for (const track of Object.values(assessment.tracks || {})) {
    for (const line of track.evidence || []) write(`• ${line}`);
  }
  write("Stakeholder guidance", true);
  for (const item of assessment.stakeholders || []) {
    write(item.title, true);
    write(item.advice);
  }
  write("Confidence", true);
  write(`${assessment.confidence.label} — ${assessment.confidence.rationale}`);
  if (assessment.next_review_utc) write(`Next review: ${fmtUtc(assessment.next_review_utc)}`);
  write(assessment.statement.attribution || "ZINGSA Space Science Department — Space Weather Advisory Centre");
  write(
    "This product separates global geomagnetic hazard from Zimbabwe GNSS reliability. Solar-wind speed alone is never classified as a geomagnetic storm.",
  );

  addFooter(doc);
  triggerDownload(doc.output("blob"), `${assessment.advisory_id}.pdf`);
}
