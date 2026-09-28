# Stack Dev Security 

Sistema de gestión de guardias de seguridad con rondas GPS + QR.

---

## Stack

| Capa       | Tecnología                          |
|------------|-------------------------------------|
| Backend    | FastAPI 0.115 + Python 3.12         |
| Base datos | MySQL 8.0 + phpMyAdmin              |
| Frontend   | React 18 + Vite + Tailwind CSS 3    |
| Auth       | JWT (passlib + python-jose)         |
| Deploy     | Docker Compose + Nginx              |

---

## Estructura del proyecto

```
stackdev_security/
├── app/
│   ├── core/         # config, database, security
│   ├── models/       # SQLAlchemy ORM (MySQL)
│   ├── schemas/      # Pydantic v2 + validación RUT
│   ├── routers/      # Endpoints FastAPI
│   └── services/     # Lógica GPS+QR, Haversine
├── frontend/
│   └── src/
│       ├── pages/    # 8 páginas React
│       ├── components/
│       ├── services/ # Axios + interceptores
│       └── store/    # Zustand (auth)
├── nginx/            # Reverse proxy
├── uploads/          # Archivos subidos
├── docker-compose.yml
├── Dockerfile
├── seed.py
└── .env.example
```

---

## Despliegue en Hostinger VPS

### 1. Requisitos previos

```bash
# En el VPS (Ubuntu 22.04)
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-plugin git

# Agregar usuario al grupo docker
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Clonar y configurar

```bash
# Subir el proyecto al VPS (opción 1: git)
git clone <tu-repo> /var/www/stackdev_security
cd /var/www/stackdev_security

# Opción 2: scp desde tu máquina local
scp -r stackdev_security/ usuario@tu_ip:/var/www/

# Crear .env desde el ejemplo
cp .env.example .env
nano .env   # Editar con tus valores reales
```

### 3. Variables de entorno obligatorias (.env)

```env
# Generar clave secreta:
#   python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=TU_CLAVE_GENERADA_AQUI

MYSQL_ROOT_PASSWORD=root_password_MUY_SEGURO
MYSQL_PASSWORD=password_MUY_SEGURO

ENVIRONMENT=production
CORS_ORIGINS=https://tudominio.com
```

### 4. SSL (recomendado con Certbot)

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d tudominio.com
sudo cp /etc/letsencrypt/live/tudominio.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/tudominio.com/privkey.pem nginx/certs/
```

> Sin dominio aún: comente los bloques SSL en nginx.conf y use solo el puerto 80.

### 5. Levantar

```bash
# Construir y levantar en background
docker compose up --build -d

# Ver logs
docker compose logs -f app

# Crear usuario administrador inicial
docker compose exec app python seed.py
```

### 6. Accesos

| Servicio    | URL                              |
|-------------|----------------------------------|
| Aplicación  | https://tudominio.com            |
| API Docs    | Solo en ENVIRONMENT=development  |
| phpMyAdmin  | https://tudominio.com/pma/       |

> phpMyAdmin está protegido por IP en nginx.conf.
> Descomente `allow TU_IP_PUBLICA;` con su IP real.

---

## Primer inicio de sesión

```
Usuario:    admin
Contraseña: admin1234
```

**⚠️ Cambie la contraseña inmediatamente en Usuarios → Editar.**

---

## Flujo operativo

### Admin/Supervisor
1. Crear instalaciones + puntos de control GPS
2. Registrar guardias (vincular a usuario del sistema)
3. Asignar turnos con fecha/hora
4. Monitorear rondas y verificaciones en Dashboard

### Guardia (desde teléfono)
1. Iniciar sesión → Ver turno activo en Dashboard
2. Ir a **Mi Ronda** → Ver puntos de control
3. Verificar cada punto con **GPS** o **escáner QR**
4. Reportar incidentes desde **Incidentes**

---

## Comandos útiles

```bash
# Reiniciar app sin reconstruir
docker compose restart app

# Ver base de datos
docker compose exec db mysql -u stackdev -p stackdev_security

# Backup MySQL
docker compose exec db mysqldump -u root -p stackdev_security > backup_$(date +%F).sql

# Actualizar y reconstruir
git pull
docker compose up --build -d
```

---

## Radio GPS por defecto

El radio de validación GPS es **50 metros** (configurable en `.env`):

```env
CHECKPOINT_RADIO_METROS=50
```

---

## Roles del sistema

| Rol        | Permisos                                              |
|------------|-------------------------------------------------------|
| admin      | Todo: usuarios, guardias, turnos, instalaciones       |
| supervisor | Guardias, turnos, instalaciones, ver incidentes       |
| usuario    | Ver su turno, hacer ronda GPS+QR, reportar incidentes |
