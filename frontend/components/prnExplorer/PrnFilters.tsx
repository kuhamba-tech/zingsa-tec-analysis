"use client";

interface Props {
  stations: string[];
  prns: string[];
  station: string;
  start: string;
  end: string;
  elevMin: number;
  selectedPrns: string[];
  onStation: (value: string) => void;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  onElevMin: (value: number) => void;
  onSelectedPrns: (value: string[]) => void;
  onRefresh: () => void;
  loading: boolean;
}

export default function PrnFilters({
  stations,
  prns,
  station,
  start,
  end,
  elevMin,
  selectedPrns,
  onStation,
  onStart,
  onEnd,
  onElevMin,
  onSelectedPrns,
  onRefresh,
  loading,
}: Props) {
  const togglePrn = (prn: string) => {
    onSelectedPrns(
      selectedPrns.includes(prn)
        ? selectedPrns.filter((p) => p !== prn)
        : [...selectedPrns, prn],
    );
  };

  return (
    <div className="card">
      <div className="prn-filter-grid">
        <label className="form-label">
          Station
          <select className="form-select" value={station} onChange={(e) => onStation(e.target.value)}>
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s} value={s}>{s.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Start
          <input className="form-input" type="datetime-local" value={start} onChange={(e) => onStart(e.target.value)} />
        </label>
        <label className="form-label">
          End
          <input className="form-input" type="datetime-local" value={end} onChange={(e) => onEnd(e.target.value)} />
        </label>
        <label className="form-label">
          Elevation min: {elevMin} deg
          <input type="range" min={0} max={45} step={5} value={elevMin} onChange={(e) => onElevMin(Number(e.target.value))} />
        </label>
        <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {prns.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.8rem" }}>
          {prns.slice(0, 36).map((prn) => (
            <button
              key={prn}
              type="button"
              className={`tab${selectedPrns.includes(prn) ? " active" : ""}`}
              style={{ padding: "0.32rem 0.55rem", fontSize: "0.72rem" }}
              onClick={() => togglePrn(prn)}
            >
              {prn}
            </button>
          ))}
          {selectedPrns.length > 0 && (
            <button type="button" className="tab" style={{ padding: "0.32rem 0.55rem", fontSize: "0.72rem" }} onClick={() => onSelectedPrns([])}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
