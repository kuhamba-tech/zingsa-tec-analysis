"""Book-style numbered display equations for the VTEC Theory page."""
from __future__ import annotations

from typing import Any


def equation_record(latex: str, number: str, caption: str = "") -> dict[str, str]:
    """Serializable equation block for API / React."""
    return {"latex": latex.strip(), "number": number, "caption": caption}


def variables_records(rows: list[tuple[str, str]]) -> list[dict[str, str]]:
    return [{"symbol": sym, "meaning": meaning} for sym, meaning in rows]


def render_book_equation(
    st_module: Any,
    latex: str,
    eq_num: str,
    caption: str = "",
) -> None:
    """
    Render a centred, numbered display equation (textbook style).

    * Equation number on the right — (4.1)
    * Optional italic caption below the expression
    """
    body = latex.strip()
    if r"\tag{" not in body:
        body = f"{body}\n\\tag{{{eq_num}}}"
    st_module.markdown('<div class="vtec-eq-wrap">', unsafe_allow_html=True)
    st_module.latex(body)
    if caption:
        safe = (
            caption.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        st_module.markdown(
            f'<div class="vtec-eq-caption">{safe}</div>',
            unsafe_allow_html=True,
        )
    st_module.markdown("</div>", unsafe_allow_html=True)


def _sym(symbol: str, meaning: str) -> tuple[str, str]:
    """Variable-key row: symbol (Unicode or HTML) + plain-English meaning."""
    return (symbol, meaning)


# ── Step 1 ───────────────────────────────────────────────────────────────────
EQ_4_1 = r"""
\delta\rho
  = \int_{\mathrm{sat}}^{\mathrm{rec}}
    \left( \frac{c}{\upsilon} - 1 \right) \mathrm{d}l
"""

# ── Step 2 ───────────────────────────────────────────────────────────────────
EQ_4_2 = r"""
\eta = \sqrt{1 - \frac{40.3\,N_{\mathrm{e}}}{f^{2}}}
"""

EQ_4_3 = r"""
\eta_{\mathrm{p}} = 1 - \frac{40.3\,N_{\mathrm{e}}}{f^{2}}
"""

EQ_4_4 = r"""
\eta_{\mathrm{g}} = 1 + \frac{40.3\,N_{\mathrm{e}}}{f^{2}}
"""

# ── Step 3 ───────────────────────────────────────────────────────────────────
EQ_4_5 = r"""
\delta\rho
  = \frac{40.3}{f^{2}}
    \int_{\mathrm{sat}}^{\mathrm{rec}} N_{\mathrm{e}}\,\mathrm{d}l
  = \frac{40.3}{f^{2}}\,\mathrm{STEC}
"""

# ── Step 4 ───────────────────────────────────────────────────────────────────
EQ_4_8 = r"""
\begin{aligned}
  C_{2} - C_{1}
    &= \Delta\rho
     = \delta\rho_{2} - \delta\rho_{1} \\[4pt]
  &= \frac{40.3\,\mathrm{TEC}\,\bigl(f_{1}^{2} - f_{2}^{2}\bigr)}
          {f_{1}^{2}\,f_{2}^{2}}
\end{aligned}
"""

EQ_4_10 = r"""
\mathrm{TEC}_{\mathrm{G}}
  = \frac{f_{1}^{2}\,f_{2}^{2}}{40.3\,\bigl(f_{1}^{2} - f_{2}^{2}\bigr)}
    \,\bigl(C_{2} - C_{1}\bigr)
"""

# ── Step 4b ──────────────────────────────────────────────────────────────────
EQ_4_12 = r"""
\mathrm{TEC}_{\mathrm{P}}
  = \frac{f_{1}^{2}\,f_{2}^{2}}{40.3\,\bigl(f_{1}^{2} - f_{2}^{2}\bigr)}
    \,\bigl(L_{1} - L_{2}\bigr)
"""

# ── Step 5 ───────────────────────────────────────────────────────────────────
EQ_4_13 = r"""
\text{Slip} =
\begin{cases}
  \text{No}  & \text{if } \lvert x_{i} - x_{i-1} \rvert \le \sigma_{10} \\[6pt]
  \text{Yes} & \text{if } \lvert x_{i} - x_{i-1} \rvert >  \sigma_{10}
\end{cases}
"""

# ── Step 6 ───────────────────────────────────────────────────────────────────
EQ_4_14 = r"""
y_{i} =
\begin{cases}
  x_{i}                    & \text{if } \lvert x_{i} - \mu \rvert < 2\sigma \\[6pt]
  \text{(outlier, remove)} & \text{if } \lvert x_{i} - \mu \rvert \ge 2\sigma
\end{cases}
"""

EQ_4_15 = r"""
\mathrm{TEC}_{\mathrm{R}}
  = \mathrm{TEC}_{\mathrm{P}}
  + \underbrace{
      \frac{1}{N}\sum_{i=1}^{N}
      \Bigl(
        \mathrm{TEC}_{\mathrm{G},\,i} - \mathrm{TEC}_{\mathrm{P},\,i}
      \Bigr)
    }_{\text{arc ambiguity offset}}
"""

# ── Step 7 ───────────────────────────────────────────────────────────────────
EQ_4_21 = r"""
\sigma_{k}(t)
  = \sqrt{
      \frac{1}{M_{t}}
      \sum_{j=1}^{M_{t}}
      \Bigl[
        \mathrm{VTEC}_{j}^{\,k}(t)
        - \overline{\mathrm{VTEC}}^{\,k}(t)
      \Bigr]^{2}
    }
"""

EQ_4_22 = r"""
\sigma_{\mathrm{Total}}(k) = \sum_{i=1}^{N} \sigma_{k}(t_{i})
"""

# ── Step 8 ───────────────────────────────────────────────────────────────────
EQ_4_17 = r"""
S(E) = \left[
  1 - \left(
    \frac{R_{\mathrm{E}}\cos E}{R_{\mathrm{E}} + H_{\mathrm{IPP}}}
  \right)^{\!2}
\right]^{-\frac{1}{2}}
"""

# ── Step 9 ───────────────────────────────────────────────────────────────────
EQ_4_16 = r"""
\mathrm{VTEC}
  = \frac{
      \mathrm{TEC}_{\mathrm{R}}
      - \mathrm{DCB}_{\mathrm{R}}
      - \mathrm{DCB}_{\mathrm{S},\,i}
    }{S(E)}
"""

# ── Step 10 ──────────────────────────────────────────────────────────────────
EQ_4_18 = r"""
\psi_{\mathrm{pp}}
  = \frac{\pi}{2} - E
  - \arcsin\!\left(
      \frac{R_{\mathrm{E}}\cos E}{R_{\mathrm{E}} + H_{\mathrm{IPP}}}
    \right)
"""

EQ_4_19 = r"""
\varphi_{\mathrm{pp}}
  = \arcsin\!\left(
      \sin\varphi_{\mathrm{u}}\,\sin\psi_{\mathrm{pp}}
      + \cos\varphi_{\mathrm{u}}\,\cos\psi_{\mathrm{pp}}\,\cos A
    \right)
"""

EQ_4_20 = r"""
\lambda_{\mathrm{pp}}
  = \lambda_{\mathrm{u}}
  + \arcsin\!\left(
      \frac{\sin\psi_{\mathrm{pp}}\,\sin A}{\cos\varphi_{\mathrm{pp}}}
    \right)
"""

# Variable keys — symbols rendered as inline LaTeX in the HTML table
VARS_STEP_1 = [
    _sym("<em>c</em>", "Speed of light in vacuum (3 × 10⁸ m s⁻¹)"),
    _sym("<em>υ</em>", "Propagation velocity of the signal through the ionosphere"),
    _sym("<em>dl</em>", "Infinitesimal path element along the ray (satellite → receiver)"),
    _sym("δ<em>ρ</em>", "Ionospheric range delay (m); positive for code, negative for carrier phase"),
]

VARS_STEP_2 = [
    _sym("η<sub>p</sub>", "Phase refractive index (carrier phase advance)"),
    _sym("η<sub>g</sub>", "Group refractive index (pseudorange delay)"),
    _sym("40.3", "Constant <em>e</em>²/(8π²ε<em>m</em>) ≈ 40.308 m³ s⁻²"),
    _sym("<em>N</em><sub>e</sub>", "Free-electron number density (electrons m⁻³)"),
    _sym("<em>f</em>", "Carrier frequency (Hz); L1 = 1.57542 × 10⁹ Hz, L2 = 1.2276 × 10⁹ Hz"),
]

VARS_STEP_3 = [
    _sym("STEC", "Slant Total Electron Content along the line of sight (TECU)"),
    _sym("∫<em>N</em><sub>e</sub> <em>dl</em>", "Line integral of electron density from satellite to receiver"),
    _sym("<em>f</em>", "Carrier frequency (Hz); delay ∝ 1/<em>f</em>² (dispersive medium)"),
]

VARS_STEP_4 = [
    _sym("<em>C</em><sub>1</sub>, <em>C</em><sub>2</sub>", "Pseudorange (code) observations on L1 and L2 (m)"),
    _sym("<em>f</em><sub>1</sub> = 1575.42 MHz", "GPS L1 frequency"),
    _sym("<em>f</em><sub>2</sub> = 1227.60 MHz", "GPS L2 frequency"),
    _sym("TEC<sub>G</sub>", "Code-derived TEC — absolute but noisy (~1–3 TECU RMS)"),
]

VARS_STEP_4B = [
    _sym("<em>L</em><sub>1</sub>, <em>L</em><sub>2</sub>", "Carrier-phase observations on L1 and L2 (m)"),
    _sym("TEC<sub>P</sub>", "Phase-derived TEC — precise (~0.003 TECU) but ambiguous"),
    _sym("<em>N</em>", "Unknown integer cycle ambiguity at tracking start"),
]

VARS_STEP_5 = [
    _sym("<em>x</em><sub><em>i</em></sub>", "Phase TEC (TEC<sub>P</sub>) at epoch <em>i</em>"),
    _sym("<em>x</em><sub><em>i</em>−1</sub>", "Phase TEC at the previous epoch"),
    _sym("σ<sub>10</sub>", "Standard deviation of TEC<sub>P</sub> over the previous 10 samples"),
]

VARS_STEP_6 = [
    _sym("TEC<sub>R</sub>", "Levelled slant TEC (absolute + precise)"),
    _sym("<em>N</em>", "Number of epochs in one continuous arc (elevation > 20°)"),
    _sym("μ, σ", "Mean and standard deviation of arc offsets (MAD filter)"),
    _sym("Arc", "Continuous observations from one PRN without time gaps"),
]

VARS_STEP_7 = [
    _sym("DCB<sub>S<em>i</em></sub>", "Satellite DCB for PRN <em>i</em> (from IGS/CODE)"),
    _sym("DCB<sub>R</sub>", "Receiver DCB — estimated by minimising σ<sub>Total</sub>"),
    _sym("<em>M</em><sub><em>t</em></sub>", "Satellites in view at epoch <em>t</em> (elevation > 30°)"),
    _sym("VTEC<sub><em>j</em></sub><sup><em>k</em></sup>(<em>t</em>)", "VTEC from satellite <em>j</em> for trial DCB <em>k</em>"),
    _sym("σ<sub>Total</sub>", "Daily spread objective; minimised at the correct DCB<sub>R</sub>"),
]

VARS_STEP_8 = [
    _sym("<em>S</em>(<em>E</em>)", "Mapping function (≥ 1; equals 1 at zenith)"),
    _sym("<em>E</em>", "Satellite elevation angle above the horizon"),
    _sym("<em>R</em><sub>E</sub>", "Earth mean radius ≈ 6378 km"),
    _sym("<em>H</em><sub>IPP</sub>", "Ionospheric shell height (typically 350–400 km)"),
]

VARS_STEP_9 = [
    _sym("VTEC", "Vertical TEC at the IPP (TECU)"),
    _sym("TEC<sub>R</sub>", "Levelled slant TEC from Step 6"),
    _sym("DCB<sub>R</sub>", "Receiver hardware bias from Step 7"),
    _sym("DCB<sub>S<em>i</em></sub>", "Satellite hardware bias (IGS/CODE)"),
    _sym("<em>S</em>(<em>E</em>)", "Mapping function from Step 8"),
]

VARS_STEP_10 = [
    _sym("φ<sub>u</sub>, λ<sub>u</sub>", "Receiver geodetic latitude and longitude"),
    _sym("<em>E</em>", "Satellite elevation angle (rad)"),
    _sym("<em>A</em>", "Satellite azimuth from North (rad)"),
    _sym("ψ<sub>pp</sub>", "Earth-centre angle from receiver to IPP projection"),
    _sym("φ<sub>pp</sub>, λ<sub>pp</sub>", "IPP geographic coordinates"),
]
