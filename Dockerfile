FROM python:3.11-slim

# Встановлюємо робочу директорію
WORKDIR /app

# Копіюємо ВСІ файли та папки з вашого проєкту
COPY . .

# Встановлюємо залежності з requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Команда для запуску веб-сервера Gunicorn
<<<<<<< HEAD
CMD ["gunicorn", "web_app:app"]
=======
CMD ["gunicorn", "web_app:app"]
>>>>>>> 1afb70d7c3f49543edc792af8d47f602652349a1
