# ── Stage 1: Build del frontend ───────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm install

# Copiar todo el frontend incluyendo .env si existe
COPY frontend/ ./

# npm run build lee automáticamente el archivo .env de Vite
# VITE_MAPBOX_TOKEN es un token PÚBLICO que queda en el bundle JS
# visible para cualquier usuario — no es un secreto sensible
RUN rm -rf dist && npm run build

# ── Stage 2: Backend Python ───────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc default-libmysqlclient-dev pkg-config curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY seed.py .

COPY --from=frontend-builder /frontend/dist ./frontend/dist

RUN mkdir -p uploads

EXPOSE 8000

# CMD en formato JSON — maneja correctamente SIGTERM para shutdown limpio
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level info"]
