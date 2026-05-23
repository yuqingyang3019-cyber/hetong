from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    from .contract.config import DRAFTS_DIR, UPLOADS_DIR
except ImportError:
    from contract.config import DRAFTS_DIR, UPLOADS_DIR


def _unlink(path: Path) -> bool:
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def remove_upload(upload: dict[str, Any]) -> list[str]:
    removed: list[str] = []
    upload_id = str(upload.get("id") or "")
    file_path = Path(str(upload.get("path") or ""))
    if file_path and _unlink(file_path):
        removed.append(str(file_path))
    if upload_id:
        record_path = UPLOADS_DIR / f"{upload_id}.json"
        if _unlink(record_path):
            removed.append(str(record_path))
    return removed


def remove_contract_files(contract_id: str, contract_path: str | Path | None) -> list[str]:
    removed: list[str] = []
    if contract_path:
        path = Path(contract_path)
        if _unlink(path):
            removed.append(str(path))
    draft_path = DRAFTS_DIR / f"{contract_id}.json"
    if _unlink(draft_path):
        removed.append(str(draft_path))
    return removed
