"""Verify RINEX converter against Karoi april sample files."""
from __future__ import annotations

import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

KAROI_APRIL = Path(
    r"C:\Users\Tapiwa\Documents\Timothy\ZINGSA\Space Science\TEC ANAlYSIS\karoi\april"
)
SAMPLE_ZIP = KAROI_APRIL / "karo0970.rnx.zip"


def main() -> int:
    from tec_core import TecConfig, read_rinex_files
    from zgiis.processing.rinex_converter import RinexConvertConfig, convert_inputs

    if not SAMPLE_ZIP.exists():
        print(f"MISSING: {SAMPLE_ZIP}")
        return 1

    with tempfile.TemporaryDirectory(prefix="karo_rinex_") as tmp:
        work = Path(tmp)
        with zipfile.ZipFile(SAMPLE_ZIP) as zf:
            zf.extractall(work)

        obs = work / "karo0970.24o"
        nav_n = work / "karo0970.24n"
        nav_g = work / "karo0970.24g"
        print(f"Extracted: obs={obs.stat().st_size:,} B, nav={nav_n.stat().st_size:,} B")

        # 1) RINEX read (processing pipeline)
        cfg = TecConfig()
        df = read_rinex_files([obs], cfg, nav_files=[nav_n, nav_g])
        print(f"read_rinex_files: {len(df)} rows, cols={list(df.columns)[:8]}...")
        if df.empty:
            print("FAIL: read_rinex_files returned empty")
            return 1

        # 2) RINEX converter
        out_dir = work / "converted"
        conv_cfg = RinexConvertConfig(product_type="rinex3")
        results = convert_inputs([obs, nav_n, nav_g], out_dir, conv_cfg)
        ok = 0
        for r in results:
            status = "OK" if r.ok else "FAIL"
            print(f"  [{status}] {r.input_name} -> {r.output_name}: {r.message}")
            if r.ok and r.output_name:
                ok += 1
        outs = list(out_dir.glob("*")) if out_dir.exists() else []
        print(f"Converter outputs: {len(outs)} files")
        for p in outs:
            print(f"  {p.name}: {p.stat().st_size:,} B")

        if ok == 0:
            print("FAIL: no successful conversions")
            return 1

        conv_obs = out_dir / "karo0970.24o_conv.obs"
        if conv_obs.exists():
            print(f"Converted observation file exists: {conv_obs.stat().st_size:,} B")
        else:
            print("WARN: expected karo0970.24o_conv.obs not found")

    print("PASS: Karoi april RINEX converter verification succeeded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
