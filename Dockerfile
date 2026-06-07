# ── Stage 1: Build del frontend ───────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

# Copiar package files primero para aprovechar cache de Docker
COPY frontend/package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código fuente
COPY frontend/ ./

# Construir el bundle de producción
RUN npm run build

# Verificar que el build se generó correctamente
RUN ls -la dist/ && echo "✓ Frontend build exitoso"

# ── Stage 2: Backend Python ───────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

# Dependencias del sistema para MySQL
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc default-libmysqlclient-dev pkg-config curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código del backend
COPY app/ ./app/
COPY seed.py .

# Copiar el dist del frontend desde el stage anterior
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Verificar que el dist quedó en el lugar correcto
RUN ls -la frontend/dist/ && echo "✓ Frontend dist copiado correctamente"

# Directorio para uploads
RUN mkdir -p uploads

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level info
