"use client";

import { useRef, useState, type ReactNode } from "react";
import { convertRinex } from "@/lib/api";
import type { RinexConvertConfig } from "@/lib/types";

type ConverterTab = "general" | "contents" | "info";

const DEFAULT_CONFIG: RinexConvertConfig = {
  product_type: "rinex3",
  observation_rate: "original",
  archive_type: "none",
  use_multiple_extensions: false,
  include_observations: true,
  include_observables: "all_freq_code_phase",
  satellite_system: "all",
  product_dynamics: "static",
  compact_rinex: false,
  include_doppler: true,
  include_snr: true,
  include_l2c: true,
  include_navigation: true,
  observer: "",
  agency: "",
  include_meteo: false,
  meteo_device_name: "",
  meteo_manufacturer: "",
  include_auxiliary: false,
  aux_device_name: "",
  aux_manufacturer: "",
  general_header: "",
  obs_header: "",
  nav_header: "",
  meteo_header: "",
  aux_header: "",
};

function FieldRow({
  label,
  children,
  disabled,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`rinex-conv-row${disabled ? " rinex-conv-row--disabled" : ""}`}>
      <span className="rinex-conv-label">{label}</span>
      {children}
    </label>
  );
}

function HeaderField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <FieldRow label={label} disabled={disabled}>
      <div className="rinex-conv-header-row">
        <textarea
          className="rinex-conv-textarea"
          rows={2}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="rinex-conv-browse" disabled={disabled} title="Edit header text">
          …
        </button>
      </div>
    </FieldRow>
  );
}

export default function RinexConverterPanel() {
  const [subTab, setSubTab] = useState<ConverterTab>("general");
  const [cfg, setCfg] = useState<RinexConvertConfig>(DEFAULT_CONFIG);
  const [mdbNames, setMdbNames] = useState("No files selected");
  const [destPath, setDestPath] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  function patch<K extends keyof RinexConvertConfig>(key: K, value: RinexConvertConfig[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  function onFilesSelected(list: FileList | null) {
    const picked = list ? Array.from(list) : [];
    setFiles(picked);
    setMdbNames(picked.length ? picked.map((f) => f.name).join(", ") : "No files selected");
  }

  function resetForm() {
    setCfg(DEFAULT_CONFIG);
    setFiles([]);
    setMdbNames("No files selected");
    setDestPath("");
    setStatus("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleConvert() {
    if (files.length === 0) {
      setStatus("Select MDB or RINEX source files first.");
      return;
    }
    setLoading(true);
    setStatus("Converting…");
    try {
      const blob = await convertRinex(files, cfg);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = destPath.trim() ? `${destPath.replace(/[/\\]+$/, "")}.zip` : "rinex_converted.zip";
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Done — downloaded ${a.download}`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rinex-conv">
      <div className="rinex-conv-titlebar">RINEX conversion</div>

      <div className="tabs rinex-conv-tabs">
        <button type="button" className={`tab${subTab === "general" ? " active" : ""}`} onClick={() => setSubTab("general")}>
          General
        </button>
        <button type="button" className={`tab${subTab === "contents" ? " active" : ""}`} onClick={() => setSubTab("contents")}>
          Contents
        </button>
        <button type="button" className={`tab${subTab === "info" ? " active" : ""}`} onClick={() => setSubTab("info")}>
          RINEX Info
        </button>
      </div>

      {subTab === "general" && (
        <div className="rinex-conv-body">
          <FieldRow label="Product Type:">
            <select className="rinex-conv-select" value={cfg.product_type} onChange={(e) => patch("product_type", e.target.value as RinexConvertConfig["product_type"])}>
              <option value="rinex3">RINEX 3.x</option>
              <option value="rinex2">RINEX 2.x</option>
            </select>
          </FieldRow>

          <fieldset className="rinex-conv-fieldset">
            <legend>MDB files</legend>
            <FieldRow label="Selected files:">
              <div className="rinex-conv-header-row">
                <input className="rinex-conv-input" readOnly value={mdbNames} />
                <button type="button" className="rinex-conv-browse" onClick={() => fileRef.current?.click()}>
                  …
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="file-picker-input"
                  accept=".mdb,.MDB,.dat,.tgd,.t02,.o,.O,.obs,.rnx,.24o,.24n,.n,.nav"
                  onChange={(e) => onFilesSelected(e.currentTarget.files)}
                />
              </div>
            </FieldRow>
          </fieldset>

          <fieldset className="rinex-conv-fieldset">
            <legend>RINEX files</legend>
            <FieldRow label="Observation rate:">
              <select className="rinex-conv-select" value={cfg.observation_rate} onChange={(e) => patch("observation_rate", e.target.value as RinexConvertConfig["observation_rate"])}>
                <option value="original">Original</option>
                <option value="1hz">1 Hz</option>
                <option value="30s">30 s</option>
                <option value="15s">15 s</option>
              </select>
            </FieldRow>
            <FieldRow label="Archive type:">
              <select className="rinex-conv-select" value={cfg.archive_type} onChange={(e) => patch("archive_type", e.target.value as RinexConvertConfig["archive_type"])}>
                <option value="none">None</option>
                <option value="gzip">GZIP</option>
                <option value="hatanaka">Hatanaka</option>
              </select>
            </FieldRow>
            <FieldRow label="Use multiple extensions:">
              <input type="checkbox" checked={cfg.use_multiple_extensions} onChange={(e) => patch("use_multiple_extensions", e.target.checked)} />
            </FieldRow>
            <FieldRow label="Destination path:">
              <input className="rinex-conv-input" value={destPath} placeholder="Optional download name (without .zip)" onChange={(e) => setDestPath(e.target.value)} />
            </FieldRow>
          </fieldset>
        </div>
      )}

      {subTab === "contents" && (
        <div className="rinex-conv-body">
          <fieldset className="rinex-conv-fieldset">
            <legend>
              <label>
                <input type="checkbox" checked={cfg.include_observations} onChange={(e) => patch("include_observations", e.target.checked)} />
                {" "}Observations
              </label>
            </legend>
            <FieldRow label="Include observables:" disabled={!cfg.include_observations}>
              <select className="rinex-conv-select" disabled={!cfg.include_observations} value={cfg.include_observables} onChange={(e) => patch("include_observables", e.target.value)}>
                <option value="all_freq_code_phase">All frequencies code and phase</option>
                <option value="code_only">Code only</option>
                <option value="phase_only">Phase only</option>
              </select>
            </FieldRow>
            <FieldRow label="Satellite System:" disabled={!cfg.include_observations}>
              <select className="rinex-conv-select" disabled={!cfg.include_observations} value={cfg.satellite_system} onChange={(e) => patch("satellite_system", e.target.value)}>
                <option value="all">All</option>
                <option value="G">GPS</option>
                <option value="R">GLONASS</option>
                <option value="E">Galileo</option>
                <option value="C">BeiDou</option>
              </select>
            </FieldRow>
            <FieldRow label="Product dynamics:" disabled={!cfg.include_observations}>
              <select className="rinex-conv-select" disabled={!cfg.include_observations} value={cfg.product_dynamics} onChange={(e) => patch("product_dynamics", e.target.value as RinexConvertConfig["product_dynamics"])}>
                <option value="static">Static</option>
                <option value="kinematic">Kinematic</option>
              </select>
            </FieldRow>
            <FieldRow label="Compact RINEX:" disabled={!cfg.include_observations}>
              <input type="checkbox" disabled={!cfg.include_observations} checked={cfg.compact_rinex} onChange={(e) => patch("compact_rinex", e.target.checked)} />
            </FieldRow>
            <FieldRow label="Doppler:" disabled={!cfg.include_observations}>
              <input type="checkbox" disabled={!cfg.include_observations} checked={cfg.include_doppler} onChange={(e) => patch("include_doppler", e.target.checked)} />
            </FieldRow>
            <FieldRow label="SNR Values:" disabled={!cfg.include_observations}>
              <input type="checkbox" disabled={!cfg.include_observations} checked={cfg.include_snr} onChange={(e) => patch("include_snr", e.target.checked)} />
            </FieldRow>
            <FieldRow label="L2C:" disabled={!cfg.include_observations}>
              <input type="checkbox" disabled={!cfg.include_observations} checked={cfg.include_l2c} onChange={(e) => patch("include_l2c", e.target.checked)} />
            </FieldRow>
          </fieldset>

          <fieldset className="rinex-conv-fieldset">
            <legend>
              <label>
                <input type="checkbox" checked={cfg.include_navigation} onChange={(e) => patch("include_navigation", e.target.checked)} />
                {" "}Navigation
              </label>
            </legend>
            <FieldRow label="Observer:" disabled={!cfg.include_navigation}>
              <input className="rinex-conv-input" disabled={!cfg.include_navigation} value={cfg.observer} onChange={(e) => patch("observer", e.target.value)} />
            </FieldRow>
            <FieldRow label="Agency:" disabled={!cfg.include_navigation}>
              <input className="rinex-conv-input" disabled={!cfg.include_navigation} value={cfg.agency} onChange={(e) => patch("agency", e.target.value)} />
            </FieldRow>
          </fieldset>

          <fieldset className="rinex-conv-fieldset">
            <legend>
              <label>
                <input type="checkbox" checked={cfg.include_meteo} onChange={(e) => patch("include_meteo", e.target.checked)} />
                {" "}Meteorological sensor measurements
              </label>
            </legend>
            <FieldRow label="Device name:" disabled={!cfg.include_meteo}>
              <input className="rinex-conv-input" disabled={!cfg.include_meteo} value={cfg.meteo_device_name} onChange={(e) => patch("meteo_device_name", e.target.value)} />
            </FieldRow>
            <FieldRow label="Manufacturer:" disabled={!cfg.include_meteo}>
              <input className="rinex-conv-input" disabled={!cfg.include_meteo} value={cfg.meteo_manufacturer} onChange={(e) => patch("meteo_manufacturer", e.target.value)} />
            </FieldRow>
          </fieldset>

          <fieldset className="rinex-conv-fieldset">
            <legend>
              <label>
                <input type="checkbox" checked={cfg.include_auxiliary} onChange={(e) => patch("include_auxiliary", e.target.checked)} />
                {" "}Auxiliary sensor measurements (tilt sensor)
              </label>
            </legend>
            <FieldRow label="Device name:" disabled={!cfg.include_auxiliary}>
              <input className="rinex-conv-input" disabled={!cfg.include_auxiliary} value={cfg.aux_device_name} onChange={(e) => patch("aux_device_name", e.target.value)} />
            </FieldRow>
            <FieldRow label="Manufacturer:" disabled={!cfg.include_auxiliary}>
              <input className="rinex-conv-input" disabled={!cfg.include_auxiliary} value={cfg.aux_manufacturer} onChange={(e) => patch("aux_manufacturer", e.target.value)} />
            </FieldRow>
          </fieldset>
        </div>
      )}

      {subTab === "info" && (
        <div className="rinex-conv-body">
          <fieldset className="rinex-conv-fieldset">
            <legend>General header for all RINEX output:</legend>
            <HeaderField label="" value={cfg.general_header} onChange={(v) => patch("general_header", v)} />
          </fieldset>
          <fieldset className="rinex-conv-fieldset">
            <legend>Additional header for individual RINEX output:</legend>
            <HeaderField label="O-file (observation):" value={cfg.obs_header} onChange={(v) => patch("obs_header", v)} />
            <HeaderField label="N-file (navigation):" value={cfg.nav_header} onChange={(v) => patch("nav_header", v)} />
            <HeaderField label="M-file (meteorological):" value={cfg.meteo_header} onChange={(v) => patch("meteo_header", v)} disabled={!cfg.include_meteo} />
            <HeaderField label="A-file (auxiliary, eg. tilt):" value={cfg.aux_header} onChange={(v) => patch("aux_header", v)} disabled={!cfg.include_auxiliary} />
          </fieldset>
        </div>
      )}

      {status && <div className="banner banner-info" style={{ fontSize: "0.8rem" }}>{status}</div>}

      <div className="rinex-conv-actions">
        <button type="button" className="btn btn-primary" disabled={loading} onClick={handleConvert}>
          {loading ? "Converting…" : "Convert"}
        </button>
        <button type="button" className="btn" onClick={resetForm}>
          Close
        </button>
      </div>
    </div>
  );
}
