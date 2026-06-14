"""Visual CORS signal-flow diagram with equipment imagery."""
from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from typing import Iterable, Optional

_FLOW_STAGES = (
    {
        "key": "antenna",
        "title": "AR20 / AR10 Antenna",
        "accent": "#ff8c00",
        "caption": "GNSS signals · L1 / L2 / L5",
        "detail": "Leica AR20 choke ring · Leica AR10 geodetic radome",
        "files": ("antenna_pair", "ar20", "ar10", "antenna"),
    },
    {
        "key": "receiver",
        "title": "Leica GR50 Receiver",
        "accent": "#00d4ff",
        "caption": "Tracks GPS · GLONASS · Galileo · BeiDou",
        "detail": "555-channel reference station receiver",
        "files": ("gr50", "receiver"),
    },
    {
        "key": "server",
        "title": "ZINGSA CORS Server",
        "accent": "#a78bfa",
        "caption": "NTRIP caster · port 2101",
        "detail": "RINEX / CMN archive · real-time corrections",
        "files": ("cors_server", "server"),
    },
    {
        "key": "platform",
        "title": "ZGIIS Platform",
        "accent": "#f472b6",
        "caption": "TEC · monitoring · alerts",
        "detail": "Ionosphere analytics, space weather and CORS health",
        "files": ("zgiis_platform", "zgiis", "platform"),
    },
)

_PATH_STEPS = (
    ("Coaxial cable", "low-loss RF"),
    ("Ethernet / LTE", "RINEX · CMN · NTRIP"),
    ("ZINGSA API", "ionosphere · space weather"),
)


def _connector_html(label: str, note: str) -> str:
    return (
        "<div class='cors-flow-connector'>"
        "<div class='cors-flow-connector-track'>"
        "<div class='cors-flow-arrow'>→</div>"
        "<div class='cors-flow-pulse'></div>"
        "</div>"
        f"<div class='cors-flow-connector-label'>{label}</div>"
        f"<div class='cors-flow-connector-note'>{note}</div>"
        "</div>"
    )


def _mime(path: Path) -> str:
    guessed = mimetypes.guess_type(path.name)[0]
    if guessed:
        return guessed
    if path.suffix.lower() == ".svg":
        return "image/svg+xml"
    return "application/octet-stream"


def _data_uri(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{_mime(path)};base64,{encoded}"


def _resolve_image(root: Path, names: Iterable[str]) -> Optional[Path]:
    hw_dir = root / "static" / "hardware"
    exts = (".jpg", ".jpeg", ".png", ".webp", ".svg")
    for name in names:
        for ext in exts:
            candidate = hw_dir / f"{name}{ext}"
            if candidate.exists():
                return candidate
    logo = root / "static" / "zingsa_logo.png"
    if "zgiis" in names and logo.exists():
        return logo
    return None


def _stage_image(stage: dict, root: Path) -> str:
    path = _resolve_image(root, stage["files"])
    if path is None:
        fallback = root / "static" / "hardware" / f"{stage['files'][0]}.svg"
        path = fallback if fallback.exists() else None

    if stage["key"] == "antenna" and (path is None or path.suffix.lower() == ".svg"):
        ar10 = _resolve_image(root, ("ar10",))
        ar20 = _resolve_image(root, ("ar20",))
        if ar10 and ar20:
            return (
                "<div class='cors-flow-img-duo'>"
                f"<img class='cors-flow-img' src='{_data_uri(ar20)}' alt='Leica AR20' loading='lazy'/>"
                f"<img class='cors-flow-img' src='{_data_uri(ar10)}' alt='Leica AR10' loading='lazy'/>"
                "</div>"
            )

    if path is None:
        return "<div class='cors-flow-img cors-flow-img-fallback'>📡</div>"
    return (
        f"<img class='cors-flow-img' src='{_data_uri(path)}' "
        f"alt='{stage['title']}' loading='lazy'/>"
    )


def _stage_html(stage: dict, root: Path, index: int) -> str:
    return (
        f"<div class='cors-flow-stage' style='--stage-accent:{stage['accent']}'>"
        f"<div class='cors-flow-stage-badge' style='background:{stage['accent']}'>"
        f"{index}</div>"
        f"<div class='cors-flow-img-wrap' style='border-color:{stage['accent']}'>"
        f"<div class='cors-flow-img-spotlight'></div>"
        f"{_stage_image(stage, root)}"
        f"</div>"
        f"<div class='cors-flow-stage-body'>"
        f"<div class='cors-flow-stage-title' style='color:{stage['accent']}'>{stage['title']}</div>"
        f"<div class='cors-flow-stage-caption'>{stage['caption']}</div>"
        f"<div class='cors-flow-stage-detail'>{stage['detail']}</div>"
        f"</div>"
        f"</div>"
    )


def build_signal_flow_html(root: Path) -> str:
    """Inline connectors between four compact equipment stages."""
    flow_items: list[str] = []
    for idx, stage in enumerate(_FLOW_STAGES, start=1):
        flow_items.append(_stage_html(stage, root, idx))
        if idx < len(_FLOW_STAGES):
            label, note = _PATH_STEPS[idx - 1]
            flow_items.append(_connector_html(label, note))

    return (
        "<div class='cors-signal-flow'>"
        "<div class='cors-signal-flow-head'>Signal Flow Diagram</div>"
        "<div class='cors-signal-flow-inline'>"
        + "".join(flow_items)
        + "</div>"
        "<div class='cors-signal-flow-foot'>"
        "Equipment imagery: Leica GR50 · Leica AR10 · Leica AR20 · ZINGSA CORS Network"
        "</div>"
        "</div>"
    )


def render_signal_flow(st_module, root: Path, *, height: int = 420) -> None:
    """Render diagram in an iframe so large equipment images do not break later HTML."""
    import streamlit.components.v1 as components

    from zgiis.cors.signal_flow_styles import CORS_SIGNAL_FLOW_CSS

    body = build_signal_flow_html(root)
    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
html, body {{
  margin: 0;
  padding: 0;
  width: 100%;
  min-width: 100%;
  box-sizing: border-box;
  background: #060d1a;
  color: #ffffff;
  font-family: Arial, Helvetica, sans-serif;
  overflow-x: hidden;
  overflow-y: hidden;
}}
body {{
  display: block;
  padding: 0.1rem 0;
}}
{CORS_SIGNAL_FLOW_CSS}
</style></head>
<body>
{body}
<script>
(function () {{
  function resizeFrame() {{
    var root = document.querySelector(".cors-signal-flow");
    if (!root) return;
    var h = Math.ceil(root.getBoundingClientRect().height + 12);
    window.parent.postMessage({{type: "streamlit:setFrameHeight", height: h}}, "*");
  }}
  window.addEventListener("load", resizeFrame);
  window.addEventListener("resize", resizeFrame);
  if (document.fonts && document.fonts.ready) {{
    document.fonts.ready.then(resizeFrame);
  }}
  Array.from(document.images || []).forEach(function (img) {{
    if (!img.complete) img.addEventListener("load", resizeFrame);
  }});
  setTimeout(resizeFrame, 120);
  setTimeout(resizeFrame, 500);
}})();
</script>
</body></html>""",
        height=height,
        scrolling=False,
    )


def equipment_image_uri(root: Path, *names: str) -> Optional[str]:
    """Return a data-URI for hardware card imagery, if available."""
    path = _resolve_image(root, names)
    if path is None:
        return None
    return _data_uri(path)
