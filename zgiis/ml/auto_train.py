"""Background CNN-GRU training when weights are missing but archive data exists."""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def maybe_train_cnn_gru(*, epochs: int = 30) -> dict | None:
    """
    Train and save CNN-GRU weights when the model file is absent.
    Returns the training metrics dict, or None if skipped.
    """
    try:
        from zgiis.ml.cnn_gru import _TORCH_OK, model_exists
        if not _TORCH_OK:
            log.info("CNN-GRU auto-train skipped: PyTorch not installed")
            return None
        if model_exists():
            return None

        from zgiis.db.timescale import TecDB
        from zgiis.ml.trainer import prepare_dataset, train

        db = TecDB()
        _, _, meta = prepare_dataset(db)
        if not meta.get("ok"):
            log.info(
                "CNN-GRU auto-train skipped: insufficient resampled data (%s rows, %s epochs)",
                meta.get("n_rows"),
                meta.get("n_epochs"),
            )
            return None

        log.info(
            "CNN-GRU model missing — auto-training on %d windows (%d 15-min epochs)",
            meta.get("n_windows"),
            meta.get("n_epochs"),
        )
        result = train(db, epochs=epochs)
        if result.get("error"):
            log.warning("CNN-GRU auto-train failed: %s", result["error"])
        else:
            log.info(
                "CNN-GRU auto-train complete — final loss %.5f",
                result.get("final_loss", 0),
            )
        return result
    except Exception as exc:
        log.warning("CNN-GRU auto-train error: %s", exc)
        return None
