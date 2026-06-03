import React from 'react'
import { EmptyState } from './index.jsx'
import { AlertTriangle } from 'lucide-react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Could log to external service here
    // console.error(error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-lg mx-auto mt-6 animate-slide-up">
          <EmptyState
            icon={AlertTriangle}
            title="Error al cargar la página"
            description="Ocurrió un error inesperado. Intenta recargar o contacta al administrador."
          />
        </div>
      )
    }
    return this.props.children
  }
}
