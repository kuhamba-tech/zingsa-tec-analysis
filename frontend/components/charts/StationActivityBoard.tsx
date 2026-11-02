"use client";

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

export default function StationActivityBoard({ board }: { board: Board }) {
  const rows = board.stations;
  const width = rows[0]?.cells.length ?? 0;
  const ticks = width > 1 ? [0, width - 1] : width === 1 ? [0] : [];

  return (
    <div className={styles.board}>
      <div className={styles.legend}>
        <span><i className={styles.receive} /> Receive data</span>
        <span><i className={styles.connecting} /> Connecting</span>
        <span><i className={styles.unknown} /> Unknown</span>
        <span><i className={styles.empty} /> No sample</span>
      </div>
      <div className={styles.scroll}>
        <div
          className={styles.head}
          style={{ gridTemplateColumns: `minmax(9rem, 1.3fr) 3.4rem 6.4rem 3.4rem minmax(${Math.max(width, 12)}rem, 3fr)` }}
        >
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
            style={{ gridTemplateColumns: `minmax(9rem, 1.3fr) 3.4rem 6.4rem 3.4rem minmax(${Math.max(width, 12)}rem, 3fr)` }}
          >
            <span className={styles.name}>
              {row.station_name}
              {row.surveyor ? <em title="Surveyor General site. Shown here, and kept out of the 19-station count.">SG</em> : null}
            </span>
            <span className={styles.code}>{row.station_code.toUpperCase()}</span>
            <span className={row.activity === "receive data" ? styles.activityOn : row.activity === "connecting" ? styles.activityOff : styles.activityQuiet}>
              {row.activity}
            </span>
            <span className={styles.pct}>{row.activity === "no samples" ? "—" : row.online_pct.toFixed(1)}</span>
            <span className={styles.strip} aria-label={`${row.station_name} activity`}>
              {row.cells.split("").map((cell, index) => {
                const start = bucketTime(board.start, index, board.bucket_minutes);
                const end = bucketTime(board.start, index + 1, board.bucket_minutes);
                return (
                  <i
                    key={`${row.station_code}-${index}`}
                    className={cellClass(cell)}
                    title={`${row.station_code.toUpperCase()} · ${CAT.format(start)}–${CAT.format(end)} CAT · ${cellLabel(cell)}`}
                  />
                );
              })}
            </span>
          </div>
        ))}
      </div>
      <p className={styles.note}>
        Each row is one station. Green means the archive recorded data coming in. Red means the station was connecting. Times are CAT. Each block is {board.bucket_minutes} min.
      </p>
    </div>
  );
}
