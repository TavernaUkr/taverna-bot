# services/auth_service.py
import hmac
import hashlib
import json
import logging
from urllib.parse import unquote
from typing import Optional, Dict, Any
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext # <-- НОВИЙ ІМПОРТ
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from database.db import get_db, AsyncSession
from database.models import User, UserRole # <-- Додано UserRole

from config_reader import config

logger = logging.getLogger(__name__)

# --- НОВЕ: Налаштування для Паролів та JWT (План 21) ---

# 1. Створюємо контекст для хешування паролів
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 2. Секретний ключ для JWT-токенів (беремо з токена бота для простоти)
#    У "бойовому" проекті тут має бути окремий `JWT_SECRET_KEY`
JWT_SECRET_KEY = config.bot_token.get_secret_value()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 днів

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Перевіряє, чи збігається пароль з хешем."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Створює хеш пароля."""
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Створює JWT-токен."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    """Декодує та валідує JWT-токен."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        # TODO: Додати перевірку `user_id` з payload у БД
        return payload
    except JWTError as e:
        logger.warning(f"Помилка валідації JWT-токену: {e}")
        return None

# ---
# Існуюча функція (з Фази 3.2)
# ---

def validate_init_data(init_data: str) -> Optional[Dict[str, Any]]:
    """
    Перевіряє хеш initData, отриманий від Telegram MiniApp.
    """
    try:
        bot_token = config.bot_token.get_secret_value()
        
        parsed_data = {}
        for field in init_data.split('&'):
            key, value = field.split('=', 1)
            parsed_data[key] = unquote(value)

        if "hash" not in parsed_data:
            logger.warning("Invalid initData: 'hash' field is missing")
            return None

        hash_to_check = parsed_data.pop("hash")
        
        auth_date_ts = int(parsed_data.get("auth_date", 0))
        auth_date = datetime.fromtimestamp(auth_date_ts, timezone.utc)
        if datetime.now(timezone.utc) - auth_date > timedelta(hours=1):
             logger.warning("Invalid initData: Data is older than 1 hour")
             return None

        data_check_string = "\n".join(
            f"{k}={v}" for k, v in sorted(parsed_data.items())
        )
        
        secret_key = hmac.new(
            "WebAppData".encode(), bot_token.encode(), hashlib.sha256
        ).digest()
        
        calculated_hash = hmac.new(
            secret_key, data_check_string.encode(), hashlib.sha256
        ).hexdigest()
        
        if calculated_hash == hash_to_check:
            if "user" in parsed_data:
                return json.loads(parsed_data["user"])
            return {}
        else:
            logger.error(f"CRITICAL: Invalid initData hash. Possible attack.")
            return None

    except Exception as e:
        logger.error(f"Помилка валідації initData: {e}", exc_info=True)
        return None

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login-email")

async def get_current_user(
    token: str = Depends(oauth2_scheme), 
    db: AsyncSession = Depends(get_db)
) -> User:
    # ... (код функції get_current_user) ...
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None: raise credentials_exception
    user_id_str = payload.get("sub")
    if user_id_str is None: raise credentials_exception
    try:
        user_id = int(user_id_str)
    except ValueError:
        raise credentials_exception
    user = await db.get(User, user_id)
    if user is None: raise credentials_exception
    return user

async def get_current_supplier_or_admin(
    current_user: User = Depends(get_current_user)
) -> User:
    # ... (код функції get_current_supplier_or_admin) ...
    if current_user.role not in (UserRole.supplier, UserRole.admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user

# --- [НОВА ФУНКЦІЯ - ФАЗА 3.10] ---
async def get_current_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    "Супер-Охоронець" (План 22). Дозволяє доступ ТІЛЬКИ Адміну.
    """
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user