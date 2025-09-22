FROM python:3.11-slim

WORKDIR /app
COPY . /app

RUN pip install -taverna-bot -r requirements.txt

CMD ["gunicorn", "web_app:app"]
