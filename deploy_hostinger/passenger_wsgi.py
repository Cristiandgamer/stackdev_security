"""
Entry point para Hostinger cPanel → Python App (Passenger WSGI).
Coloca este archivo en la raíz de tu aplicación Python en cPanel.
"""
import sys
import os

# Agregar el directorio de la app al path
APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)

# Cargar variables de entorno desde .env
from dotenv import load_dotenv
load_dotenv(os.path.join(APP_DIR, ".env"))

# Importar la app FastAPI y exponerla como application WSGI/ASGI
from app.main import app as fastapi_app

# Passenger necesita una variable llamada 'application'
# Usamos asgiref para adaptar ASGI → WSGI
try:
    from asgiref.wsgi import WsgiToAsgi
    # Para Passenger que soporte ASGI directamente:
    application = fastapi_app
except ImportError:
    # Fallback WSGI con a2wsgi
    from a2wsgi import ASGIMiddleware
    application = ASGIMiddleware(fastapi_app)
