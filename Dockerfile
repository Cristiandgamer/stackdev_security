# ── Stage 1: Build del frontend ───────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

# Declarar ARG para recibir variables de build de Railway
# Railway pasa automáticamente las variables de entorno como ARGs
# si se declaran aquí antes del build
ARG VITE_MAPBOX_TOKEN
ARG VITE_API_BASE_URL

# Convertir ARGs a ENV para que Vite los lea durante npm run build
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./

# Limpiar build anterior y construir con las variables inyectadas
RUN rm -rf dist && npm run build

# Verificar que el token fue incluido en el bundle
RUN grep -r "mapboxgl" dist/ > /dev/null && echo "✓ Mapbox incluido en bundle" || echo "⚠ Mapbox no encontrado"

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

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level info
