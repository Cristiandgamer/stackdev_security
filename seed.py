"""Crea el usuario admin inicial. Ejecutar una sola vez después del primer deploy."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal, engine, Base
from app.core.security import hash_password
from app.models.usuario import Usuario

Base.metadata.create_all(bind=engine)

db = SessionLocal()

if db.query(Usuario).filter(Usuario.email == "admin@stackdev.cl").first():
    print("✓ Usuario admin ya existe")
else:
    admin = Usuario(
        nombre="Administrador",
        apellido="",
        username="admin",
        email="admin@stackdev.cl",
        hashed_password=hash_password("admin1234"),
        rol="admin",
    )
    db.add(admin)
    db.commit()
    print("✓ Usuario admin creado: admin@stackdev.cl / admin1234")
    print("  ⚠️  Cambiar la contraseña después del primer acceso!")

db.close()
