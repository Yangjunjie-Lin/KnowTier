from __future__ import annotations

import hashlib
import io
import re
import zipfile
from pathlib import Path
from uuid import UUID

from cognigraph.config import Settings
from cognigraph.domain.enums import InputKind

_SAFE_SUFFIXES = {".pdf", ".docx", ".pptx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
_FILENAME = re.compile(r"^[^/\\\x00]+$")
_MIME_BY_SUFFIX: dict[str, frozenset[str]] = {
    ".pdf": frozenset({"application/pdf"}),
    ".docx": frozenset({"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),
    ".pptx": frozenset(
        {"application/vnd.openxmlformats-officedocument.presentationml.presentation"}
    ),
    ".txt": frozenset({"text/plain"}),
    ".md": frozenset({"text/markdown", "text/plain"}),
    ".png": frozenset({"image/png"}),
    ".jpg": frozenset({"image/jpeg"}),
    ".jpeg": frozenset({"image/jpeg"}),
    ".tif": frozenset({"image/tiff"}),
    ".tiff": frozenset({"image/tiff"}),
}


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def validate_upload(
    *,
    filename: str,
    mime_type: str,
    content: bytes,
    settings: Settings,
) -> InputKind:
    if not filename or not _FILENAME.fullmatch(filename) or Path(filename).name != filename:
        raise ValueError("filename must not contain a path")
    suffix = Path(filename).suffix.casefold()
    if suffix not in _SAFE_SUFFIXES:
        raise ValueError(f"unsupported file extension: {suffix or '<none>'}")
    if mime_type not in settings.allowed_mime_types:
        raise ValueError(f"unsupported MIME type: {mime_type}")
    if mime_type not in _MIME_BY_SUFFIX[suffix]:
        raise ValueError("file extension and MIME type do not match")
    if not content:
        raise ValueError("uploaded file is empty")
    if len(content) > settings.max_upload_bytes:
        raise ValueError("uploaded file exceeds the configured size limit")
    _validate_file_signature(suffix, content, settings.max_upload_bytes)
    return input_kind_for(mime_type, suffix)


def _validate_file_signature(suffix: str, content: bytes, max_upload_bytes: int) -> None:
    if suffix == ".pdf" and not content.startswith(b"%PDF-"):
        raise ValueError("PDF signature is invalid")
    if suffix == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("PNG signature is invalid")
    if suffix in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise ValueError("JPEG signature is invalid")
    if suffix in {".tif", ".tiff"} and not content.startswith((b"II*\x00", b"MM\x00*")):
        raise ValueError("TIFF signature is invalid")
    if suffix in {".txt", ".md"}:
        if b"\x00" in content:
            raise ValueError("text upload contains binary null bytes")
        try:
            content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("text upload must be UTF-8 encoded") from exc
    if suffix not in {".docx", ".pptx"}:
        return
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = set(archive.namelist())
            total_size = sum(item.file_size for item in archive.infolist())
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError("Office document container is invalid") from exc
    required_prefix = "word/" if suffix == ".docx" else "ppt/"
    if "[Content_Types].xml" not in names or not any(
        name.startswith(required_prefix) for name in names
    ):
        raise ValueError("Office document contents do not match the extension")
    if total_size > max_upload_bytes * 8:
        raise ValueError("Office document expands beyond the safe size limit")


def input_kind_for(mime_type: str, suffix: str) -> InputKind:
    if mime_type == "application/pdf" or suffix == ".pdf":
        return InputKind.PDF
    if mime_type.startswith("image/"):
        return InputKind.IMAGE
    if suffix == ".pptx":
        return InputKind.PRESENTATION
    return InputKind.DOCUMENT


def safe_storage_path(root: Path, workspace_id: UUID, document_id: UUID, suffix: str) -> Path:
    base = root.resolve()
    target = (base / str(workspace_id) / f"{document_id}{suffix.casefold()}").resolve()
    if base not in target.parents:
        raise ValueError("resolved upload path escaped the storage root")
    return target
