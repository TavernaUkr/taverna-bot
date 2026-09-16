# services/gemini_key_manager.py
"""
Round-robin ротація Gemini API-ключів.
При 429 RESOURCE_EXHAUSTED ключ блокується на cooldown і береться наступний.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from config_reader import config

logger = logging.getLogger(__name__)

DEFAULT_COOLDOWN = timedelta(hours=1)


class AllKeysExhaustedError(Exception):
    """Усі Gemini-ключі тимчасово вичерпали квоту."""


class GeminiKeyManager:
    """Асинхронно/потоково безпечний round-robin менеджер ключів."""

    def __init__(
        self,
        keys: Optional[List[str]] = None,
        cooldown: timedelta = DEFAULT_COOLDOWN,
    ):
        self._lock = threading.Lock()
        self._cooldown = cooldown
        self._index = 0
        self._slots: List[Dict[str, object]] = []
        seen = set()
        for raw in keys or []:
            key = str(raw or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            self._slots.append(
                {
                    "key": key,
                    "is_exhausted": False,
                    "exhausted_at": None,
                }
            )
        if self._slots:
            logger.info("GeminiKeyManager: завантажено %s ключ(ів).", len(self._slots))
        else:
            logger.warning("GeminiKeyManager: список ключів порожній.")

    @property
    def key_count(self) -> int:
        return len(self._slots)

    def has_keys(self) -> bool:
        return bool(self._slots)

    def _revive_if_cooled_down(self, slot: Dict[str, object], now: datetime) -> None:
        if not slot["is_exhausted"]:
            return
        exhausted_at = slot["exhausted_at"]
        if not isinstance(exhausted_at, datetime):
            slot["is_exhausted"] = False
            slot["exhausted_at"] = None
            return
        if now - exhausted_at >= self._cooldown:
            slot["is_exhausted"] = False
            slot["exhausted_at"] = None
            logger.info(
                "GeminiKeyManager: ключ ...%s знову доступний після cooldown.",
                str(slot["key"])[-4:],
            )

    def get_next_active_key(self) -> str:
        with self._lock:
            if not self._slots:
                raise AllKeysExhaustedError("Немає Gemini API ключів у конфігурації.")
            now = datetime.now(timezone.utc)
            total = len(self._slots)
            for step in range(total):
                idx = (self._index + step) % total
                slot = self._slots[idx]
                self._revive_if_cooled_down(slot, now)
                if slot["is_exhausted"]:
                    continue
                self._index = (idx + 1) % total
                return str(slot["key"])
            raise AllKeysExhaustedError(
                "Усі Gemini API ключі вичерпані (429 RESOURCE_EXHAUSTED)."
            )

    def mark_key_exhausted(self, key: str) -> None:
        raw = str(key or "").strip()
        if not raw:
            return
        with self._lock:
            now = datetime.now(timezone.utc)
            for slot in self._slots:
                if slot["key"] != raw:
                    continue
                slot["is_exhausted"] = True
                slot["exhausted_at"] = now
                logger.warning(
                    "GeminiKeyManager: ключ ...%s заблоковано на %s хв (429).",
                    raw[-4:],
                    int(self._cooldown.total_seconds() // 60),
                )
                return


_manager: Optional[GeminiKeyManager] = None
_manager_lock = threading.Lock()


def get_key_manager() -> GeminiKeyManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = GeminiKeyManager(config.GEMINI_API_KEYS)
        return _manager
