# api/admin_rules.py
"""Словник правил ШІ-категоризації для адмінки Mini App."""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select

from api.admin_suppliers import _assert_admin
from api_models import AICategorizationRuleCreate, AICategorizationRuleResponse
from database.db import get_db, AsyncSession
from database.models import AICategorizationRule

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin", tags=["Admin (AI Rules)"])


@router.get("/ai-rules", response_model=List[AICategorizationRuleResponse])
async def list_ai_rules(
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _assert_admin(telegram_id, authorization)
    rows = (
        await db.execute(
            select(AICategorizationRule).order_by(AICategorizationRule.id.asc())
        )
    ).scalars().all()
    return rows


@router.post("/ai-rules", response_model=AICategorizationRuleResponse, status_code=201)
async def create_ai_rule(
    payload: AICategorizationRuleCreate,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _assert_admin(telegram_id, authorization)
    keyword = (payload.keyword or "").strip()
    category = (payload.correct_category or "").strip()
    if not keyword or not category:
        raise HTTPException(status_code=400, detail="Вкажіть ключове слово і категорію.")
    rule = AICategorizationRule(keyword=keyword, correct_category=category)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    logger.info("Адмін додав AI-правило #%s: %s → %s", rule.id, keyword, category)
    return rule


@router.delete("/ai-rules/{rule_id}")
async def delete_ai_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    telegram_id: Optional[int] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    _assert_admin(telegram_id, authorization)
    rule = await db.get(AICategorizationRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Правило не знайдено")
    await db.delete(rule)
    await db.commit()
    logger.info("Адмін видалив AI-правило #%s", rule_id)
    return {"ok": True, "rule_id": rule_id}
