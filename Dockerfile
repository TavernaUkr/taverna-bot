FROM python:3.11-slim

WORKDIR /app
COPY . /app
RUN ls -laR
# ====================================================================

RUN pip install --no-cache-dir -r requirements.txt

CMD ["gunicorn", "web_app:app"]
