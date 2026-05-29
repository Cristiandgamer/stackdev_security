import { X, AlertTriangle, Loader2 } from "lucide-react";

// Modal
export function Modal({ title, onClose, children, size = "md", open = true }) {
  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose} 
      />
      <div
        className={`relative bg-gradient-to-br from-[#1e2d3d] to-[#263548] border border-[#2d5490]/30 rounded-2xl shadow-2xl w-full ${widths[size]} max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-300`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#2d5490]/20 bg-black/20">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-[#2d5490]/30 rounded-lg transition-colors text-[#94a3b8] hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto p-6 text-white">{children}</div>
      </div>
    </div>
  );
}

// Spinner
export function Spinner({ className = "" }) {
  return <Loader2 className={`animate-spin ${className}`} size={24} />;
}

// PageHeader
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// EmptyState
export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="text-center py-12">
      {Icon && <Icon size={48} className="mx-auto text-gray-300 mb-3" />}
      <p className="text-gray-500 font-medium">{title}</p>
      {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
    </div>
  );
}

// ConfirmDialog
export function ConfirmDialog({ open = true, title, message, onConfirm, onCancel, danger = true, confirmLabel = 'Confirmar' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onCancel} 
      />
      <div 
        className="relative bg-gradient-to-br from-[#1e2d3d] to-[#263548] border border-[#2d5490]/30 rounded-2xl shadow-2xl p-6 max-w-sm w-full animate-in zoom-in-95 duration-300" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertTriangle className="text-red-400" size={24} />
          </div>
          <h3 className="font-bold text-white text-lg">{title}</h3>
        </div>
        <p className="text-sm text-[#94a3b8] mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-[#2d5490]/20 text-[#94a3b8] hover:bg-[#2d5490]/40 transition-colors text-sm font-medium">
            Cancelar
          </button>
          <button 
            onClick={onConfirm} 
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              danger 
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
                : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// FormField
export function FormField({ label, error, children }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// Alert
export function Alert({ type = "error", message }) {
  const styles = {
    error: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-amber-50 border-amber-200 text-amber-800",
    success: "bg-green-50 border-green-200 text-green-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };
  return (
    <div className={`p-3 rounded-lg border text-sm ${styles[type]}`}>
      {message}
    </div>
  );
}
