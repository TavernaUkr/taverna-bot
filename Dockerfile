# Базовий образ з Python
FROM python:3.13-slim

# Встановимо робочу директорію
WORKDIR /app

# Скопіюємо залежності
COPY requirements.txt .

# Встановимо залежності
RUN pip install --no-cache-dir -r requirements.txt

# Скопіюємо код бота
COPY . .

# Вкажемо змінну оточення для Python
ENV PYTHONUNBUFFERED=1

# Запускаємо бота
CMD ["python", "bot_updated.py"]
