# api/upload.py
"""
Завантаження зображень вітрини магазину (лого/банер) у Supabase Storage.

POST /api/v1/upload/image (multipart/form-data, поле "file")
    → { "url": "https://<supabase>/storage/v1/object/public/taverna-assets/..." }

Захист: Bearer initData (підпис Telegram Mini App). Валідація формату і
розміру — у services/storage_service.py (двоступенева: розширення + magic bytes).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, UploadFile

from api.auth import validate_init_data
from services.storage_service import MAX_ASSET_FILE_BYTES, upload_file

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/upload", tags=["Upload (Shop Assets)"])


@router.post("/image")
async def upload_image(
    file: UploadFile,
    authorization: Optional[str] = Header(default=None),
):
    """Кладе файл у бакет taverna-assets і повертає публічний URL."""
    # --- Захист: Bearer initData (підпис Telegram) ------------------------
    if not authorization or "bearer" not in authorization.lower():
        raise HTTPException(
            status_code=401,
            detail="Потрібна авторизація Telegram Mini App (Bearer initData).",
        )
    scheme, _, token = authorization.partition(" ")
    user_data = (
        validate_init_data(token.strip())
        if scheme.lower() == "bearer" and token.strip()
        else None
    )
    if user_data is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid initData: Hash mismatch or expired",
        )
    uploader_tg = user_data.get("id") if isinstance(user_data, dict) else None

    # --- Читання файлу ------------------------------------------------------
    if file is None:
        raise HTTPException(status_code=400, detail="Файл не передано (поле 'file').")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Порожній файл.")
    if len(raw) > MAX_ASSET_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Файл занадто великий: максимум 8 МБ (логотип/банер магазину).",
        )

    file_name = file.filename or "upload.jpg"
    content_type = (file.content_type or "").strip()
    url = upload_file(raw, file_name, folder="shop_assets")
    if not url:
        raise HTTPException(
            status_code=503,
            detail=(
                "Не вдалося зберегти файл (невалідний формат або Supabase "
                "недоступний). Підтримуються .jpg/.png/.webp/.gif до 8 МБ."
            ),
        )

    logger.info(
        "upload_image: telegram_id=%s, file=%s (%s, %s bytes) → %s",
        uploader_tg, file_name, content_type or "?", len(raw), url,
    )
    return {"url": url}
