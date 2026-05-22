# Deploy en Hostinger (cPanel + SSH)

## Arquitectura en producción
```
Hostinger cPanel
├── public_html/          ← Frontend React (archivos estáticos)
│   ├── index.html
│   ├── assets/
│   └── .htaccess         ← Redirige rutas al index.html (SPA)
│
└── stackdev_app/         ← Backend FastAPI (Python App)
    ├── app/
    ├── passenger_wsgi.py ← Entry point para cPanel Python App
    ├── .env              ← Variables de entorno (DB, JWT secret)
    └── requirements.txt
```

---

## Paso 1 — Base de datos MySQL en cPanel

1. En cPanel → **MySQL Databases**
2. Crear base de datos: `tuusuario_stackdev`
3. Crear usuario MySQL con contraseña segura
4. Asignar el usuario a la base con **todos los privilegios**
5. Anotar: host (`localhost`), nombre DB, usuario, contraseña

---

## Paso 2 — Subir el backend por SSH

```bash
# Conectar por SSH
ssh tuusuario@tudominio.com

# Crear carpeta de la app (fuera de public_html)
mkdir ~/stackdev_app
cd ~/stackdev_app

# Subir archivos (desde tu PC con scp o usar File Manager de cPanel)
# La estructura debe quedar:
# ~/stackdev_app/app/
# ~/stackdev_app/passenger_wsgi.py
# ~/stackdev_app/.env
# ~/stackdev_app/requirements.txt

# Instalar dependencias en entorno virtual
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Crear el .env con tus datos reales
cp .env.example .env
nano .env
```

---

## Paso 3 — Configurar .env en el servidor

```env
DATABASE_URL=mysql+pymysql://tuusuario_dbuser:tupassword@localhost:3306/tuusuario_stackdev
SECRET_KEY=genera_con_python3_-c_"import_secrets;print(secrets.token_hex(32))"
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
CHECKPOINT_RADIO_METROS=50
CORS_ORIGINS=["https://tudominio.com"]
UPLOAD_DIR=/home/tuusuario/stackdev_app/uploads
```

---

## Paso 4 — Crear tablas y usuario admin

```bash
cd ~/stackdev_app
source venv/bin/activate
python seed.py
```

---

## Paso 5 — Configurar Python App en cPanel

1. cPanel → **Setup Python App**
2. Click **Create Application**
3. Configurar:
   - **Python version**: 3.11 o 3.12
   - **Application root**: `stackdev_app`
   - **Application URL**: `tudominio.com/api` (o subdominio `api.tudominio.com`)
   - **Application startup file**: `passenger_wsgi.py`
   - **Application Entry point**: `application`
4. Click **Create** → luego **Run pip install** con `requirements.txt`

---

## Paso 6 — Subir el frontend

```bash
# En tu PC local, buildear el frontend
cd frontend
npm install
npm run build

# Subir el contenido de frontend/dist/ a public_html/
# Opciones:
#   a) FileZilla / scp
#   b) cPanel File Manager (subir zip y extraer)

scp -r dist/* tuusuario@tudominio.com:~/public_html/

# Subir también el .htaccess
scp htaccess_frontend.txt tuusuario@tudominio.com:~/public_html/.htaccess
```

---

## Paso 7 — Ajustar URL de la API en el frontend

Antes de buildear, editar `frontend/vite.config.js` para producción,
o crear `frontend/.env.production`:

```env
VITE_API_BASE_URL=https://tudominio.com/api
```

Y en `frontend/src/services/api.js` cambiar:
```js
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || "/api" });
```

---

## Paso 8 — Reiniciar la app

En cPanel → Python Apps → click **Restart** en tu aplicación.

---

## Verificar que funciona

```bash
curl https://tudominio.com/api/health
# Debe retornar: {"status":"ok","app":"Stack Dev Security"}
```

---

## Troubleshooting

| Problema | Solución |
|---|---|
| 500 en /api | Ver logs en cPanel → Logs de errores |
| DB no conecta | Verificar host es `localhost` (no `db`) en Hostinger |
| CSS no carga | Verificar que `.htaccess` está en `public_html/` |
| CORS error | Agregar tu dominio en `CORS_ORIGINS` del `.env` |
| App no reinicia | SSH: `touch ~/stackdev_app/tmp/restart.txt` |
