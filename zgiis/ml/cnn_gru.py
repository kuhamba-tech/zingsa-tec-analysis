"""
CNN-GRU ionospheric VTEC forecast model.

Architecture (Gopi-inspired, adapted for Zimbabwe CORS):
  Input  : 24 h of 15-min mean VTEC  →  shape (batch, 96, 1)
  Conv1D : extract local temporal features
  GRU    : model long-range ionospheric dynamics
  Dense  : predict next 6 h (24 × 15-min steps)

The model auto-improves daily once TimescaleDB accumulates enough data
(≥30 days).  All weights are saved to static/data/cnn_gru_model.pt.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, Tuple

log = logging.getLogger(__name__)

_MODEL_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "cnn_gru_model.pt"

# ── Try importing PyTorch ─────────────────────────────────────────────────────
try:
    import torch
    import torch.nn as nn
    _TORCH_OK = True
except ImportError:
    _TORCH_OK = False
    log.warning(
        "PyTorch not installed — CNN-GRU forecast unavailable. "
        "Install with: pip install torch --index-url https://download.pytorch.org/whl/cpu"
    )

# ── Hyperparameters ───────────────────────────────────────────────────────────
SEQ_LEN      = 96    # input length: 24 h × 4 per hour
HORIZON      = 24    # forecast length: 6 h × 4 per hour
CNN_CHANNELS = (32, 64)
CNN_KERNEL   = 3
GRU_HIDDEN   = 128
GRU_LAYERS   = 2
DROPOUT      = 0.2


if _TORCH_OK:

    class CNNGRUForecast(nn.Module):
        """
        Convolutional feature extractor + GRU temporal model.

        Conv1D layers capture short-range diurnal patterns (the ionosphere's
        14-20 TECU morning-peak, afternoon-plateau rhythm over Zimbabwe).
        The GRU then models multi-hour drift and storm dynamics from the
        feature sequence.
        """

        def __init__(
            self,
            seq_len:      int   = SEQ_LEN,
            horizon:      int   = HORIZON,
            cnn_channels: Tuple = CNN_CHANNELS,
            cnn_kernel:   int   = CNN_KERNEL,
            gru_hidden:   int   = GRU_HIDDEN,
            gru_layers:   int   = GRU_LAYERS,
            dropout:      float = DROPOUT,
        ):
            super().__init__()
            self.seq_len = seq_len
            self.horizon = horizon

            pad = cnn_kernel // 2
            self.cnn = nn.Sequential(
                nn.Conv1d(1, cnn_channels[0], cnn_kernel, padding=pad),
                nn.ReLU(),
                nn.Conv1d(cnn_channels[0], cnn_channels[1], cnn_kernel, padding=pad),
                nn.ReLU(),
                nn.Dropout(dropout),
            )
            self.gru = nn.GRU(
                input_size  = cnn_channels[1],
                hidden_size = gru_hidden,
                num_layers  = gru_layers,
                batch_first = True,
                dropout     = dropout if gru_layers > 1 else 0.0,
            )
            self.head = nn.Linear(gru_hidden, horizon)

        def forward(self, x: "torch.Tensor") -> "torch.Tensor":
            # x: (B, T, 1)
            x = x.permute(0, 2, 1)       # → (B, 1, T)  for Conv1d
            x = self.cnn(x)              # → (B, 64, T)
            x = x.permute(0, 2, 1)       # → (B, T, 64) for GRU
            _, h = self.gru(x)           # h: (layers, B, hidden)
            return self.head(h[-1])      # → (B, horizon)


# ── Public helpers ────────────────────────────────────────────────────────────

def build_model(**kwargs) -> Optional["CNNGRUForecast"]:
    """Create a new untrained CNN-GRU model."""
    if not _TORCH_OK:
        return None
    return CNNGRUForecast(**kwargs)


def save_model(model: "CNNGRUForecast", path: Path = _MODEL_PATH) -> None:
    """Persist model weights."""
    if not _TORCH_OK:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    import torch
    torch.save(model.state_dict(), str(path))
    log.info("Model saved → %s", path)


def load_model(path: Path = _MODEL_PATH) -> Optional["CNNGRUForecast"]:
    """Load weights from disk. Returns None if file missing or torch unavailable."""
    if not _TORCH_OK or not path.exists():
        return None
    import torch
    m = CNNGRUForecast()
    m.load_state_dict(torch.load(str(path), map_location="cpu"))
    m.eval()
    log.info("Model loaded ← %s", path)
    return m


def model_exists() -> bool:
    return _MODEL_PATH.exists()


def model_info() -> dict:
    return {
        "path":         str(_MODEL_PATH),
        "exists":       _MODEL_PATH.exists(),
        "torch_ok":     _TORCH_OK,
        "seq_len":      SEQ_LEN,
        "horizon":      HORIZON,
        "forecast_h":   HORIZON // 4,
    }
