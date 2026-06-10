import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { authService } from '../services/api'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [blockedUntil, setBlockedUntil] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const validate = () => {
    const e = {}
    if (!form.email.trim())  e.email    = 'Ingrese su correo'
    if (!form.password)      e.password = 'Ingrese su contraseña'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    if (blockedUntil && Date.now() < blockedUntil) return
    setLoading(true)
    try {
      const { data } = await authService.login(form)
      setAuth(data.access_token, data.user)
      await new Promise((resolve) => setTimeout(resolve, 100))
      toast.success(`Bienvenido, ${data.user.nombre}`)
      navigate('/')
    } catch (err) {
      const detail = err.response?.data?.detail
      let msg = 'Credenciales incorrectas'
      if (typeof detail === 'string') msg = detail
      else if (detail && typeof detail === 'object') msg = detail.msg || msg
      const retry = detail?.retry_after ? Number(detail.retry_after) : null
      if (retry) {
        setBlockedUntil(Date.now() + retry * 1000)
        setRemaining(Math.ceil(retry))
      }
      toast.error(msg)
      setErrors({ password: msg })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!blockedUntil) return
    const iv = setInterval(() => {
      const secs = Math.ceil((blockedUntil - Date.now()) / 1000)
      if (secs <= 0) { setBlockedUntil(null); setRemaining(0); clearInterval(iv) }
      else setRemaining(secs)
    }, 1000)
    return () => clearInterval(iv)
  }, [blockedUntil])

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#0a1628] px-5 py-8">

      {/* Logo */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-20 h-20 bg-brand rounded-3xl flex items-center justify-center shadow-2xl shadow-brand/30 mb-4">
          <Shield className="w-11 h-11 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Stack Security</h1>
        <p className="text-[#94a3b8] mt-1 text-base">Sistema de Guardias</p>
      </div>

      {/* Card formulario */}
      <div className="w-full max-w-sm bg-[#152032] border border-[#1e3a5f] rounded-3xl p-6 shadow-2xl">

        {blockedUntil && Date.now() < blockedUntil && (
          <div className="mb-4 p-3 rounded-2xl bg-red-900/40 border border-red-500/30 text-sm text-red-300 text-center">
            Demasiados intentos. Espera {remaining}s
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Email */}
          <div>
            <label htmlFor="email" className="label">Correo electrónico</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#475569]" />
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="nombre@empresa.cl"
                className={`input-field pl-12 ${errors.email ? 'border-red-500' : ''}`}
                value={form.email}
                onChange={(e) => {
                  setForm(f => ({ ...f, email: e.target.value }))
                  setErrors(er => ({ ...er, email: '' }))
                }}
              />
            </div>
            {errors.email && (
              <p className="text-red-400 text-sm mt-1.5 flex items-center gap-1">
                ⚠ {errors.email}
              </p>
            )}
          </div>

          {/* Contraseña */}
          <div>
            <label htmlFor="password" className="label">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#475569]" />
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className={`input-field pl-12 pr-12 ${errors.password ? 'border-red-500' : ''}`}
                value={form.password}
                onChange={(e) => {
                  setForm(f => ({ ...f, password: e.target.value }))
                  setErrors(er => ({ ...er, password: '' }))
                }}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#475569] hover:text-white transition-colors p-1"
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-red-400 text-sm mt-1.5 flex items-center gap-1">
                ⚠ {errors.password}
              </p>
            )}
          </div>

          {/* Botón */}
          <button
            type="submit"
            disabled={loading || (blockedUntil && Date.now() < blockedUntil)}
            className="btn-primary w-full mt-2 text-lg py-4"
          >
            {loading ? (
              <span className="flex items-center gap-2 justify-center">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Ingresando...
              </span>
            ) : 'Ingresar'}
          </button>
        </form>
      </div>

      <p className="text-[#475569] text-sm mt-6">
        Stack Security © {new Date().getFullYear()}
      </p>
    </div>
  )
}
