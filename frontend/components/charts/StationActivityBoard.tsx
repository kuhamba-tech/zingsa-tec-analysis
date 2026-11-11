"use client";

import { useId, useMemo, useState } from "react";
import type { StationActivityBoard as Board } from "@/lib/types";
import styles from "./StationActivityBoard.module.css";

const CAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Harare",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function bucketTime(startIso: string, index: number, minutes: number): Date {
  return new Date(new Date(startIso).getTime() + index * minutes * 60_000);
}

function cellClass(cell: string): string {
  if (cell === "o") return styles.receive;
  if (cell === "f") return styles.connecting;
  if (cell === "u") return styles.unknown;
  return styles.empty;
}

function cellLabel(cell: string): string {
  if (cell === "o") return "receive data";
  if (cell === "f") return "connecting";
  if (cell === "u") return "unknown";
  return "no sample";
}

function activityClass(activity: string): string {
  if (activity === "receive data") return styles.activityOn;
  if (activity === "connecting") return styles.activityOff;
  return styles.activityQuiet;
}

function fmtCat(dt: Date): string {
  return `${CAT.format(dt)} CAT`;
}

function durationLabel(bucketCount: number, bucketMinutes: number): string {
  const minutes = bucketCount * bucketMinutes;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours} h ${rem} min` : `${hours} h`;
}

type CellMeta = {
  index: number;
  cell: string;
  start: Date;
  end: Date;
  runStart: number;
  runEnd: number;
  lastReceiveBefore: Date | null;
  nextReceiveAfter: Date | null;
};

function buildCellMeta(board: Board, cells: string): CellMeta[] {
  const chars = cells.split("");
  const starts = chars.map((_, index) => bucketTime(board.start, index, board.bucket_minutes));
  const ends = chars.map((_, index) => bucketTime(board.start, index + 1, board.bucket_minutes));

  const runStart: number[] = new Array(chars.length);
  const runEnd: number[] = new Array(chars.length);
  let i = 0;
  while (i < chars.length) {
    let j = i;
    while (j + 1 < chars.length && chars[j + 1] === chars[i]) j += 1;
    for (let k = i; k <= j; k += 1) {
      runStart[k] = i;
      runEnd[k] = j;
    }
    i = j + 1;
  }

  return chars.map((cell, index) => {
    let lastReceiveBefore: Date | null = null;
    for (let k = runStart[index] - 1; k >= 0; k -= 1) {
      if (chars[k] === "o") {
        lastReceiveBefore = ends[k];
        break;
      }
    }
    let nextReceiveAfter: Date | null = null;
    for (let k = runEnd[index] + 1; k < chars.length; k += 1) {
      if (chars[k] === "o") {
        nextReceiveAfter = starts[k];
        break;
      }
    }
    return {
      index,
      cell,
      start: starts[index],
      end: ends[index],
      runStart: runStart[index],
      runEnd: runEnd[index],
      lastReceiveBefore,
      nextReceiveAfter,
    };
  });
}

function tooltipLines(meta: CellMeta, code: string, board: Board): string[] {
  const runBuckets = meta.runEnd - meta.runStart + 1;
  const downStart = bucketTime(board.start, meta.runStart, board.bucket_minutes);
  const downEnd = bucketTime(board.start, meta.runEnd + 1, board.bucket_minutes);
  const lines = [
    `${code.toUpperCase()} · ${cellLabel(meta.cell)}`,
    `Down: ${fmtCat(downStart)} → ${fmtCat(downEnd)}`,
    `Duration: ${durationLabel(runBuckets, board.bucket_minutes)}`,
  ];
  if (meta.lastReceiveBefore) {
    lines.push(`Last recorded: ${fmtCat(meta.lastReceiveBefore)}`);
  } else {
    lines.push("Last recorded: no receive-data sample before this gap");
  }
  if (meta.nextReceiveAfter) {
    lines.push(`Recorded again: ${fmtCat(meta.nextReceiveAfter)}`);
  } else if (meta.cell === "f") {
    lines.push("Recorded again: still down / not yet restored in this window");
  }
  return lines;
}

function Strip({
  board,
  code,
  name,
  cells,
}: {
  board: Board;
  code: string;
  name: string;
  cells: string;
}) {
  const tipId = useId();
  const meta = useMemo(() => buildCellMeta(board, cells), [board, cells]);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <span className={styles.strip} aria-label={`${name} activity`}>
      {meta.map((cell) => {
        const lines = tooltipLines(cell, code, board);
        const plain = lines.join(" · ");
        const isConnecting = cell.cell === "f";
        const showTip = isConnecting && hover === cell.index;
        return (
          <i
            key={`${code}-${cell.index}`}
            className={`${cellClass(cell.cell)} ${isConnecting ? styles.tipHost : ""}`}
            title={plain}
            aria-describedby={showTip ? tipId : undefined}
            onMouseEnter={() => setHover(cell.index)}
            onMouseLeave={() => setHover((current) => (current === cell.index ? null : current))}
            onFocus={() => setHover(cell.index)}
            onBlur={() => setHover((current) => (current === cell.index ? null : current))}
            tabIndex={isConnecting ? 0 : undefined}
          >
            {showTip ? (
              <span id={tipId} className={styles.tooltip} role="tooltip">
                {lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            ) : null}
          </i>
        );
      })}
    </span>
  );
}

export default function StationActivityBoard({ board }: { board: Board }) {
  const rows = board.stations;
  const width = rows[0]?.cells.length ?? 0;
  const ticks = width > 1 ? [0, width - 1] : width === 1 ? [0] : [];
  const stripMin = Math.max(width, 12);
  const desktopColumns = `minmax(9rem, 1.3fr) 3.4rem 6.4rem 3.4rem minmax(${stripMin}rem, 3fr)`;

  return (
    <div className={styles.board}>
      <div className={styles.legend}>
        <span><i className={styles.receive} /> Receive data</span>
        <span><i className={styles.connecting} /> Connecting</span>
        <span><i className={styles.unknown} /> Unknown</span>
        <span><i className={styles.empty} /> No sample</span>
      </div>

      <div className={styles.mobileList}>
        <div className={styles.mobileAxis}>
          {ticks.map((index) => (
            <span key={index}>
              {CAT.format(bucketTime(board.start, index, board.bucket_minutes))}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={`m-${row.station_code}`} className={styles.mobileRow}>
            <div className={styles.mobileMeta}>
              <span className={styles.name}>
                {row.station_name}
                {row.surveyor ? (
                  <em title="Surveyor General site. Shown here, and kept out of the 19-station count.">SG</em>
                ) : null}
              </span>
              <span className={styles.code}>{row.station_code.toUpperCase()}</span>
              <span className={activityClass(row.activity)}>{row.activity}</span>
              <span className={styles.pct}>
                {row.activity === "no samples" ? "—" : `${row.online_pct.toFixed(1)}%`}
              </span>
            </div>
            <div className={styles.mobileStripWrap}>
              <Strip
                board={board}
                code={row.station_code}
                name={row.station_name}
                cells={row.cells}
              />
            </div>
          </div>
        ))}
      </div>

      <div className={styles.scroll}>
        <div className={styles.head} style={{ gridTemplateColumns: desktopColumns }}>
          <span>Site name</span>
          <span>Code</span>
          <span>Comm activity</span>
          <span>Data %</span>
          <span className={styles.axis}>
            {ticks.map((index) => (
              <span key={index}>
                {CAT.format(bucketTime(board.start, index, board.bucket_minutes))}
              </span>
            ))}
          </span>
        </div>
        {rows.map((row) => (
          <div
            key={row.station_code}
            className={styles.row}
            style={{ gridTemplateColumns: desktopColumns }}
          >
            <span className={styles.name}>
              {row.station_name}
              {row.surveyor ? (
                <em title="Surveyor General site. Shown here, and kept out of the 19-station count.">SG</em>
              ) : null}
            </span>
            <span className={styles.code}>{row.station_code.toUpperCase()}</span>
            <span className={activityClass(row.activity)}>{row.activity}</span>
            <span className={styles.pct}>
              {row.activity === "no samples" ? "—" : row.online_pct.toFixed(1)}
            </span>
            <Strip
              board={board}
              code={row.station_code}
              name={row.station_name}
              cells={row.cells}
            />
          </div>
        ))}
      </div>
      <p className={styles.note}>
        Comm activity and the right-hand tip follow live Spider Site Status (same as the map). The rest of each bar is archived history. Hover a red block for downtime and last/next recorded times (CAT). Each block is {board.bucket_minutes} min.
      </p>
    </div>
  );
}
