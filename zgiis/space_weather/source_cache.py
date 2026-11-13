"""Small, atomic disk cache for successfully validated public source files."""
from hashlib import sha256
from pathlib import Path
import tempfile
import time


def cache_path(source: str, key: str) -> Path:
    return Path(tempfile.gettempdir()) / "zingsa-source-cache" / source / sha256(key.encode()).hexdigest()


def read_source(source: str, key: str, max_age: float, max_bytes: int = 16_000_000) -> bytes | None:
    path = cache_path(source, key)
    try:
        if time.time() - path.stat().st_mtime > max_age or path.stat().st_size > max_bytes:
            return None
        return path.read_bytes()
    except OSError:
        return None


def write_source(source: str, key: str, content: bytes) -> None:
    path = cache_path(source, key)
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            stream.write(content)
            temporary = Path(stream.name)
        temporary.replace(path)
    except OSError:
        pass  # Cache failure must not hide a successfully retrieved observation.
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
