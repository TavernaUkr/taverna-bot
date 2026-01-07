# handlers/auth_handlers.py
import logging
from fastapi import APIRouter, Depends, HTTPException, Body, status
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, EmailStr, Field
from typing import Optional

from database.db import get_db, AsyncSession
from database.models import User, UserRole
from services import auth_service # <-- Наш оновлений сервіс
from config_reader import config
from api_models import UserResponse, AuthRequest, TokenResponse, EmailRegisterRequest, EmailLoginRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth", tags=["Auth (Users)"])

# --- Функції-хелпери ---

async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    stmt = select(User).where(User.email == email.lower())
    result = await db.execute(stmt)
    return result.scalar_one_or_none()

async def get_user_by_telegram_id(db: AsyncSession, tg_id: int) -> Optional[User]:
    stmt = select(User).where(User.telegram_id == str(tg_id))
    result = await db.execute(stmt)
    return result.scalar_one_or_none()
    
def create_token_response(user: User) -> TokenResponse:
    """Створює JWT-токен та відповідь для клієнта."""
    access_token = auth_service.create_access_token(
        data={"sub": str(user.id), "role": user.role.value} # 'sub' = 'subject' (ID юзера)
    )
    return TokenResponse(
        access_token=access_token,
        user=UserResponse.model_validate(user) # Pydantic v2
    )
    
# --- API Endpoints ---

@router.post("/login-telegram", response_model=TokenResponse)
async def login_via_telegram(
    request_data: AuthRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    (Оновлено) Приймає initData з MiniApp, перевіряє його,
    знаходить/створює користувача в БД та повертає JWT-токен.
    """
    
    # 1. Перевіряємо, чи initData справжній
    user_data = auth_service.validate_init_data(request_data.initData)
    
    if user_data is None:
        logger.warning("Спроба авторизації з невалідним initData hash.")
        raise HTTPException(status_code=401, detail="Invalid initData: Hash mismatch or expired")
        
    telegram_id = user_data.get('id')
    if not telegram_id:
        raise HTTPException(status_code=400, detail="Invalid initData: 'user' field is missing")

    logger.info(f"Авторизація (Telegram) для user_id: {telegram_id}")
    
    try:
        # 2. Шукаємо користувача в БД
        user = await get_user_by_telegram_id(db, telegram_id)
        
        first_name = user_data.get('first_name', 'User')
        last_name = user_data.get('last_name')
        username = user_data.get('username')
        
        if user:
            # 3. Користувач знайдений (Логін)
            user.first_name = first_name
            user.last_name = last_name
            user.username = username
            logger.info(f"Користувач (TG) {user.telegram_id} увійшов в систему.")
        else:
            # 4. Користувач не знайдений (Реєстрація)
            user = User(
                telegram_id=str(telegram_id),
                first_name=first_name,
                last_name=last_name,
                username=username,
                role=UserRole.admin if telegram_id == config.admin_id else UserRole.user # <-- (План 21 - Адмінка)
            )
            db.add(user)
            logger.info(f"Створено нового користувача (TG): {user.telegram_id}")
            
        await db.commit()
        await db.refresh(user)
        
        # 5. Створюємо та повертаємо JWT-токен
        return create_token_response(user)

    except IntegrityError:
        await db.rollback()
        logger.warning(f"IntegrityError при реєстрації user {telegram_id}")
        user = await get_user_by_telegram_id(db, telegram_id)
        if user:
            return create_token_response(user)
        raise HTTPException(status_code=409, detail="User already exists")
    except Exception as e:
        await db.rollback()
        logger.error(f"Помилка в /auth/login-telegram: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/register-email", response_model=UserResponse)
async def register_by_email(
    request_data: EmailRegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    """(План 21) Реєстрація постачальника/адміна за Email/Паролем."""
    logger.info(f"Спроба Email-реєстрації для: {request_data.email}")
    
    # 1. Перевіряємо, чи email не зайнятий
    existing_user = await get_user_by_email(db, request_data.email)
    if existing_user:
        raise HTTPException(status_code=409, detail="Користувач з таким email вже існує")
        
    # 2. Створюємо хеш пароля
    hashed_password = auth_service.get_password_hash(request_data.password)
    
    # 3. Створюємо нового юзера
    new_user = User(
        email=request_data.email.lower(),
        password_hash=hashed_password,
        first_name=request_data.first_name,
        last_name=request_data.last_name,
        role=UserRole.supplier # Всі, хто реєструються по email - постачальники
    )
    
    try:
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        logger.info(f"Створено нового користувача (Email): {new_user.email}")
        return UserResponse.model_validate(new_user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Email вже існує")
    except Exception as e:
        await db.rollback()
        logger.error(f"Помилка в /auth/register-email: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/login-email", response_model=TokenResponse)
async def login_by_email(
    request_data: EmailLoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """(План 21) Логін постачальника/адміна за Email/Паролем."""
    logger.info(f"Спроба Email-логіну для: {request_data.email}")
    
    # 1. Знаходимо юзера
    user = await get_user_by_email(db, request_data.email)
    if not user:
        raise HTTPException(status_code=404, detail="Невірний email або пароль")
        
    # 2. Перевіряємо пароль
    if not user.password_hash or not auth_service.verify_password(request_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Невірний email або пароль")
        
    # 3. Успіх! Створюємо та повертаємо JWT-токен
    logger.info(f"Користувач (Email) {user.email} увійшов в систему.")
    return create_token_response(user)