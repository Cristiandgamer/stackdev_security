from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import os, shutil, uuid

from app.core.database import get_db
from app.core.security import require_any, require_supervisor, require_admin, get_current_user
from app.core.config import settings
from app.models.seguridad import (
    Instalacion, PuntoControl, VerificacionPunto,
    Guardia, Turno, Asistencia, Incidente,
    ArchivoIncidente, Notificacion
)
from app.models.seguridad import Ronda
from app.models.usuario import Usuario
from app.schemas.schemas import (
    InstalacionCreate, InstalacionUpdate, InstalacionOut,
    PuntoControlCreate, PuntoControlUpdate, PuntoControlOut,
    VerificacionCreate, VerificacionOut,
    GuardiaCreate, GuardiaUpdate, GuardiaOut,
    TurnoCreate, TurnoUpdate, TurnoOut, TurnoDetalleOut,
    AsistenciaOut, IncidenteCreate, IncidenteUpdate, IncidenteOut,
    NotificacionOut
)
from app.schemas.schemas import RondaCreate, RondaOut, RondaUpdate
from app.services.seguridad_service import (
    generar_qr_token, verificar_gps, verificar_qr, progreso_ronda
)

router = APIRouter()


# ── Instalaciones ──────────────────────────────────────────────────────────────

@router.get("/instalaciones", response_model=List[InstalacionOut])
def listar_instalaciones(db: Session = Depends(get_db), _=Depends(require_any)):
    return db.query(Instalacion).filter(Instalacion.activa == True).all()


@router.post("/instalaciones", response_model=InstalacionOut, status_code=201)
def crear_instalacion(data: InstalacionCreate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    inst = Instalacion(**data.model_dump())
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


@router.put("/instalaciones/{inst_id}", response_model=InstalacionOut)
def actualizar_instalacion(inst_id: int, data: InstalacionUpdate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    inst = db.query(Instalacion).filter(Instalacion.id == inst_id).first()
    if not inst:
        raise HTTPException(404, "Instalación no encontrada")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(inst, k, v)
    db.commit()
    db.refresh(inst)
    return inst


@router.delete("/instalaciones/{inst_id}", status_code=204)
def eliminar_instalacion(inst_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    inst = db.query(Instalacion).filter(Instalacion.id == inst_id).first()
    if not inst:
        raise HTTPException(404, "Instalación no encontrada")
    inst.activa = False
    db.commit()


# ── Puntos de Control ──────────────────────────────────────────────────────────

@router.get("/instalaciones/{inst_id}/puntos", response_model=List[PuntoControlOut])
def listar_puntos(inst_id: int, db: Session = Depends(get_db), _=Depends(require_any)):
    return db.query(PuntoControl).filter(
        PuntoControl.instalacion_id == inst_id,
        PuntoControl.activo == True
    ).order_by(PuntoControl.orden).all()


# ── Rondas ───────────────────────────────────────────────────────────────────


@router.get("/instalaciones/{inst_id}/rondas", response_model=List[RondaOut])
def listar_rondas(inst_id: int, db: Session = Depends(get_db), _=Depends(require_any)):
    return db.query(Ronda).filter(Ronda.instalacion_id == inst_id, Ronda.activa == True).all()


@router.post("/rondas", response_model=RondaOut, status_code=201)
def crear_ronda(data: RondaCreate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    r = Ronda(**data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.get("/rondas/{ronda_id}", response_model=RondaOut)
def get_ronda(ronda_id: int, db: Session = Depends(get_db), _=Depends(require_any)):
    r = db.query(Ronda).filter(Ronda.id == ronda_id).first()
    if not r:
        raise HTTPException(404, "Ronda no encontrada")
    return r


@router.put("/rondas/{ronda_id}", response_model=RondaOut)
def actualizar_ronda(ronda_id: int, data: RondaUpdate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    r = db.query(Ronda).filter(Ronda.id == ronda_id).first()
    if not r:
        raise HTTPException(404, "Ronda no encontrada")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(r, k, v)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/rondas/{ronda_id}", status_code=204)
def eliminar_ronda(ronda_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    r = db.query(Ronda).filter(Ronda.id == ronda_id).first()
    if not r:
        raise HTTPException(404, "Ronda no encontrada")
    r.activa = False
    db.commit()


@router.post("/puntos-control", response_model=PuntoControlOut, status_code=201)
def crear_punto(data: PuntoControlCreate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    punto = PuntoControl(**data.model_dump(), qr_token=generar_qr_token())
    db.add(punto)
    db.commit()
    db.refresh(punto)
    return punto


@router.put("/puntos-control/{punto_id}", response_model=PuntoControlOut)
def actualizar_punto(punto_id: int, data: PuntoControlUpdate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    punto = db.query(PuntoControl).filter(PuntoControl.id == punto_id).first()
    if not punto:
        raise HTTPException(404, "Punto de control no encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(punto, k, v)
    db.commit()
    db.refresh(punto)
    return punto


@router.post("/puntos-control/{punto_id}/regenerar-qr")
def regenerar_qr(punto_id: int, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    punto = db.query(PuntoControl).filter(PuntoControl.id == punto_id).first()
    if not punto:
        raise HTTPException(404, "Punto no encontrado")
    punto.qr_token = generar_qr_token()
    db.commit()
    return {"qr_token": punto.qr_token}


# ── Verificaciones / Rondas ────────────────────────────────────────────────────

@router.post("/verificaciones", response_model=VerificacionOut, status_code=201)
def crear_verificacion(data: VerificacionCreate, db: Session = Depends(get_db), _=Depends(require_any)):
    punto = db.query(PuntoControl).filter(
        PuntoControl.id == data.punto_control_id,
        PuntoControl.activo == True
    ).first()
    if not punto:
        raise HTTPException(404, "Punto de control no encontrado")

    distancia = None
    if data.metodo in ("gps", "ambos") and data.latitud_verificada and data.longitud_verificada:
        valido, distancia = verificar_gps(punto, data.latitud_verificada, data.longitud_verificada)
        if not valido:
            raise HTTPException(400, f"Fuera del rango GPS ({distancia:.0f}m del punto, máximo {punto.radio_metros}m)")

    if data.metodo in ("qr", "ambos") and data.qr_escaneado:
        if not verificar_qr(punto, data.qr_escaneado):
            raise HTTPException(400, "Código QR inválido")

    verif = VerificacionPunto(
        punto_control_id=data.punto_control_id,
        turno_id=data.turno_id,
        guardia_id=data.guardia_id,
        metodo=data.metodo,
        latitud_verificada=data.latitud_verificada,
        longitud_verificada=data.longitud_verificada,
        distancia_metros=distancia,
        qr_escaneado=data.qr_escaneado,
        notas=data.notas,
    )
    db.add(verif)
    db.commit()
    db.refresh(verif)
    return verif


@router.get("/turnos/{turno_id}/progreso-ronda")
def get_progreso_ronda(turno_id: int, db: Session = Depends(get_db), _=Depends(require_any)):
    return progreso_ronda(db, turno_id)


@router.get("/turnos/{turno_id}/verificaciones", response_model=List[VerificacionOut])
def verificaciones_turno(turno_id: int, db: Session = Depends(get_db), _=Depends(require_any)):
    return db.query(VerificacionPunto).filter(VerificacionPunto.turno_id == turno_id).all()


# ── Guardias ───────────────────────────────────────────────────────────────────

@router.get("/guardias", response_model=List[GuardiaOut])
def listar_guardias(db: Session = Depends(get_db), _=Depends(require_supervisor)):
    return db.query(Guardia).filter(Guardia.activo == True).all()


@router.post("/guardias", response_model=GuardiaOut, status_code=201)
def crear_guardia(data: GuardiaCreate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    if not data.rut and not data.usuario_id:
        raise HTTPException(422, "Se requiere RUT o usuario_id para crear un guardia")

    if data.rut and db.query(Guardia).filter(Guardia.rut == data.rut).first():
        raise HTTPException(400, "RUT ya registrado")

    payload = data.model_dump(exclude_none=True)
    if payload.get("usuario_id"):
        usuario = db.query(Usuario).filter(Usuario.id == payload["usuario_id"], Usuario.activo == True).first()
        if not usuario:
            raise HTTPException(404, "Usuario no encontrado")
        if db.query(Guardia).filter(Guardia.usuario_id == payload["usuario_id"]).first():
            raise HTTPException(400, "Ya existe un guardia asociado a este usuario")
        payload.setdefault("nombre", usuario.nombre)
        payload.setdefault("apellido", usuario.apellido or "")
        payload.setdefault("email", usuario.email)
        if not payload["apellido"]:
            raise HTTPException(400, "El usuario seleccionado no tiene apellido")

    if not payload.get("nombre") or not payload.get("apellido"):
        raise HTTPException(400, "Nombre y apellido son requeridos")

    guardia = Guardia(**payload)
    db.add(guardia)
    db.commit()
    db.refresh(guardia)
    return guardia


@router.put("/guardias/{guardia_id}", response_model=GuardiaOut)
def actualizar_guardia(guardia_id: int, data: GuardiaUpdate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    guardia = db.query(Guardia).filter(Guardia.id == guardia_id).first()
    if not guardia:
        raise HTTPException(404, "Guardia no encontrado")

    payload = data.model_dump(exclude_none=True)
    if payload.get("usuario_id") is not None:
        usuario = db.query(Usuario).filter(Usuario.id == payload["usuario_id"], Usuario.activo == True).first()
        if not usuario:
            raise HTTPException(404, "Usuario no encontrado")
        payload.setdefault("nombre", usuario.nombre)
        payload.setdefault("apellido", usuario.apellido or "")
        payload.setdefault("email", usuario.email)
        if not payload["apellido"]:
            raise HTTPException(400, "El usuario seleccionado no tiene apellido")

    for k, v in payload.items():
        setattr(guardia, k, v)
    db.commit()
    db.refresh(guardia)
    return guardia


@router.delete("/guardias/{guardia_id}", status_code=204)
def eliminar_guardia(guardia_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    g = db.query(Guardia).filter(Guardia.id == guardia_id).first()
    if not g:
        raise HTTPException(404, "Guardia no encontrado")
    g.activo = False
    db.commit()


# ── Turnos ─────────────────────────────────────────────────────────────────────

@router.get("/turnos/mi-activo", response_model=Optional[TurnoDetalleOut])
def turno_mi_activo(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from app.models.seguridad import Guardia

    guardia = db.query(Guardia).filter(Guardia.usuario_id == current_user.id).first()
    if not guardia:
        return None

    turno = db.query(Turno).filter(
        Turno.guardia_id == guardia.id,
        Turno.estado == "en_curso"
    ).first()
    if not turno:
        return None

    instalacion = turno.instalacion
    ronda = db.query(Ronda).filter(
        Ronda.instalacion_id == turno.instalacion_id,
        Ronda.activa == True
    ).order_by(Ronda.created_at.desc()).first()

    puntos = db.query(PuntoControl).filter(
        PuntoControl.instalacion_id == turno.instalacion_id,
        PuntoControl.activo == True
    ).order_by(PuntoControl.orden).all()

    verificados = {v.punto_control_id for v in db.query(VerificacionPunto).filter(VerificacionPunto.turno_id == turno.id).all()}
    puntos_data = [
        {
            **{
                "id": p.id,
                "instalacion_id": p.instalacion_id,
                "ronda_id": p.ronda_id,
                "nombre": p.nombre,
                "descripcion": p.descripcion,
                "latitud": p.latitud,
                "longitud": p.longitud,
                "radio_metros": p.radio_metros,
                "orden": p.orden,
                "qr_token": p.qr_token,
                "activo": p.activo,
                "created_at": p.created_at,
            },
            "verificado": p.id in verificados
        }
        for p in puntos
    ]

    progreso = progreso_ronda(db, turno.id)
    return {
        "id": turno.id,
        "guardia_id": turno.guardia_id,
        "instalacion_id": turno.instalacion_id,
        "fecha_inicio": turno.fecha_inicio,
        "fecha_fin": turno.fecha_fin,
        "estado": turno.estado,
        "notas": turno.notas,
        "created_at": turno.created_at,
        "instalacion": instalacion,
        "ronda": ronda,
        "puntos": puntos_data,
        "progreso": progreso,
    }


@router.get("/turnos", response_model=List[TurnoOut])
def listar_turnos(
    guardia_id: Optional[int] = None,
    instalacion_id: Optional[int] = None,
    estado: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_any)
):
    q = db.query(Turno)
    if guardia_id:
        q = q.filter(Turno.guardia_id == guardia_id)
    if instalacion_id:
        q = q.filter(Turno.instalacion_id == instalacion_id)
    if estado:
        q = q.filter(Turno.estado == estado)
    return q.order_by(Turno.fecha_inicio.desc()).limit(200).all()


@router.post("/turnos", response_model=TurnoOut, status_code=201)
def crear_turno(data: TurnoCreate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    turno = Turno(**data.model_dump())
    db.add(turno)
    db.commit()
    db.refresh(turno)
    return turno


@router.put("/turnos/{turno_id}", response_model=TurnoOut)
def actualizar_turno(turno_id: int, data: TurnoUpdate, db: Session = Depends(get_db), _=Depends(require_any)):
    turno = db.query(Turno).filter(Turno.id == turno_id).first()
    if not turno:
        raise HTTPException(404, "Turno no encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(turno, k, v)
    db.commit()
    db.refresh(turno)
    return turno


# ── Asistencias ────────────────────────────────────────────────────────────────

@router.get("/asistencias", response_model=List[AsistenciaOut])
def listar_asistencias(
    guardia_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_supervisor)
):
    q = db.query(Asistencia)
    if guardia_id:
        q = q.filter(Asistencia.guardia_id == guardia_id)
    return q.order_by(Asistencia.created_at.desc()).limit(200).all()


@router.post("/asistencias/entrada")
def registrar_entrada(
    turno_id: int,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    turno = db.query(Turno).filter(Turno.id == turno_id).first()
    if not turno:
        raise HTTPException(404, "Turno no encontrado")
    existente = db.query(Asistencia).filter(Asistencia.turno_id == turno_id).first()
    if existente:
        raise HTTPException(400, "Ya existe asistencia para este turno")
    asistencia = Asistencia(
        turno_id=turno_id,
        guardia_id=turno.guardia_id,
        entrada=datetime.utcnow(),
        latitud_entrada=lat,
        longitud_entrada=lon,
    )
    db.add(asistencia)
    turno.estado = "en_curso"
    db.commit()
    db.refresh(asistencia)
    return asistencia


@router.post("/asistencias/salida")
def registrar_salida(turno_id: int, db: Session = Depends(get_db), _=Depends(require_any)):
    asistencia = db.query(Asistencia).filter(Asistencia.turno_id == turno_id).first()
    if not asistencia:
        raise HTTPException(404, "No hay registro de entrada para este turno")
    asistencia.salida = datetime.utcnow()
    turno = db.query(Turno).filter(Turno.id == turno_id).first()
    if turno:
        turno.estado = "finalizado"
    db.commit()
    return asistencia


# ── Incidentes ─────────────────────────────────────────────────────────────────

@router.get("/incidentes", response_model=List[IncidenteOut])
def listar_incidentes(
    instalacion_id: Optional[int] = None,
    estado: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_any)
):
    q = db.query(Incidente)
    if instalacion_id:
        q = q.filter(Incidente.instalacion_id == instalacion_id)
    if estado:
        q = q.filter(Incidente.estado == estado)
    return q.order_by(Incidente.reportado_en.desc()).limit(200).all()


@router.post("/incidentes", response_model=IncidenteOut, status_code=201)
def crear_incidente(data: IncidenteCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    incidente = Incidente(**data.model_dump())
    db.add(incidente)
    db.flush()

    # Notificar a supervisores y admins
    supervisores = db.query(Usuario).filter(
        Usuario.rol.in_(["admin", "supervisor"]),
        Usuario.activo == True
    ).all()
    for sup in supervisores:
        notif = Notificacion(
            usuario_id=sup.id,
            titulo=f"Incidente: {data.titulo}",
            mensaje=data.descripcion or "",
            tipo="incidente",
            referencia_id=incidente.id,
            referencia_tipo="incidente"
        )
        db.add(notif)

    db.commit()
    db.refresh(incidente)
    return incidente


@router.put("/incidentes/{incidente_id}", response_model=IncidenteOut)
def actualizar_incidente(incidente_id: int, data: IncidenteUpdate, db: Session = Depends(get_db), _=Depends(require_supervisor)):
    incidente = db.query(Incidente).filter(Incidente.id == incidente_id).first()
    if not incidente:
        raise HTTPException(404, "Incidente no encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(incidente, k, v)
    if data.estado in ("resuelto", "cerrado"):
        incidente.resuelto_en = datetime.utcnow()
    db.commit()
    db.refresh(incidente)
    return incidente


@router.post("/incidentes/{incidente_id}/archivos")
async def subir_archivo(
    incidente_id: int,
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_any)
):
    incidente = db.query(Incidente).filter(Incidente.id == incidente_id).first()
    if not incidente:
        raise HTTPException(404, "Incidente no encontrado")

    ext = os.path.splitext(archivo.filename)[1]
    nombre_unico = f"{uuid.uuid4()}{ext}"
    ruta = os.path.join(settings.UPLOAD_DIR, nombre_unico)
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    with open(ruta, "wb") as f:
        shutil.copyfileobj(archivo.file, f)

    registro = ArchivoIncidente(
        incidente_id=incidente_id,
        nombre_archivo=archivo.filename,
        ruta=f"/uploads/{nombre_unico}",
        tipo_mime=archivo.content_type,
    )
    db.add(registro)
    db.commit()
    return {"url": f"/uploads/{nombre_unico}", "nombre": archivo.filename}


# ── Notificaciones ─────────────────────────────────────────────────────────────

@router.get("/notificaciones", response_model=List[NotificacionOut])
def mis_notificaciones(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return db.query(Notificacion).filter(
        Notificacion.usuario_id == current_user.id
    ).order_by(Notificacion.created_at.desc()).limit(50).all()


@router.post("/notificaciones/{notif_id}/leer")
def marcar_leida(notif_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    n = db.query(Notificacion).filter(
        Notificacion.id == notif_id,
        Notificacion.usuario_id == current_user.id
    ).first()
    if not n:
        raise HTTPException(404, "Notificación no encontrada")
    n.leida = True
    db.commit()
    return {"ok": True}


# ── Estadísticas ───────────────────────────────────────────────────────────────

@router.get("/estadisticas/dashboard")
def dashboard_stats(db: Session = Depends(get_db), _=Depends(require_supervisor)):
    from sqlalchemy import func
    return {
        "total_guardias": db.query(Guardia).filter(Guardia.activo == True).count(),
        "total_instalaciones": db.query(Instalacion).filter(Instalacion.activa == True).count(),
        "turnos_hoy": db.query(Turno).filter(
            func.date(Turno.fecha_inicio) == func.curdate()
        ).count(),
        "incidentes_abiertos": db.query(Incidente).filter(
            Incidente.estado == "abierto"
        ).count(),
        "incidentes_criticos": db.query(Incidente).filter(
            Incidente.severidad == "critica",
            Incidente.estado != "cerrado"
        ).count(),
    }
