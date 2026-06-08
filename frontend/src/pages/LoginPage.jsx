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

      // 1. Guardar token y usuario en el store
      setAuth(data.access_token, data.user)

      // 2. Esperar a que Zustand persista en sessionStorage antes de navegar
      //    Esto evita la condición de carrera donde requests del dashboard
      //    salen antes de que el token esté disponible en sessionStorage
      await new Promise((resolve) => setTimeout(resolve, 100))

      toast.success(`Bienvenido, ${data.user.nombre}`)

      // 3. Navegar al dashboard
      navigate('/')
    } catch (err) {
      const detail = err.response?.data?.detail
      let msg = 'Credenciales incorrectas'
      if (typeof detail === 'string') msg = detail
      else if (detail && typeof detail === 'object') msg = detail.msg || msg

      const retry = detail && detail.retry_after ? Number(detail.retry_after) : null
      if (retry) {
        const until = Date.now() + retry * 1000
        setBlockedUntil(until)
        setRemaining(Math.ceil(retry))
        toast.error(msg)
        setErrors({ password: msg })
      } else {
        toast.error(msg)
        setErrors({ password: msg })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!blockedUntil) return
    const iv = setInterval(() => {
      const secs = Math.ceil((blockedUntil - Date.now()) / 1000)
      if (secs <= 0) {
        setBlockedUntil(null)
        setRemaining(0)
        clearInterval(iv)
      } else {
        setRemaining(secs)
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [blockedUntil])

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#0f2440] p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-brand/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#1e3a5f]/80 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-20 h-20 bg-brand rounded-2xl flex items-center justify-center shadow-2xl shadow-brand/30 mb-4">
            <Shield className="w-11 h-11 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Stack Security</h1>
          <p className="text-[#94a3b8] text-lg mt-1">Sistema de Seguridad</p>
        </div>

        <div className="card p-8">
          <h2 className="text-xl font-semibold text-white mb-6 text-center">
            Iniciar sesión
          </h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {blockedUntil && Date.now() < blockedUntil && (
              <div className="p-3 rounded-lg bg-red-800/80 text-sm text-white text-center">
                Demasiados intentos. Intenta nuevamente en {remaining} segundos.
              </div>
            )}

            <div>
              <label htmlFor="email" className="label">Correo electrónico</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94a3b8]" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nombre@gmail.com"
                  className={`input-field pl-14 ${errors.email ? 'border-red-500' : ''}`}
                  value={form.email}
                  onChange={(e) => {
                    setForm(f => ({ ...f, email: e.target.value }))
                    setErrors(er => ({ ...er, email: '' }))
                  }}
                />
              </div>
              {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="label">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94a3b8]" />
                <input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`input-field pl-14 pr-12 ${errors.password ? 'border-red-500' : ''}`}
                  value={form.password}
                  onChange={(e) => {
                    setForm(f => ({ ...f, password: e.target.value }))
                    setErrors(er => ({ ...er, password: '' }))
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-white transition-colors !min-h-0 p-1"
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={loading || (blockedUntil && Date.now() < blockedUntil)}
              className="btn-primary w-full text-lg py-4 mt-2"
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

        <p className="text-center text-[#94a3b8] text-sm mt-6">
          Stack Security © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
