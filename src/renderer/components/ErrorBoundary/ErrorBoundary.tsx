import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error('[ErrorBoundary]', error, info);
    // Tenta salvar em localStorage pra debug
    try {
      localStorage.setItem(
        'undrcode.lastError',
        JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: info.componentStack,
          ts: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleContinue = () => {
    this.setState({ hasError: false, error: null, info: null });
  };

  handleCopyError = () => {
    const text = `${this.state.error?.message}\n\n${this.state.error?.stack}\n\nComponent stack:${this.state.info?.componentStack ?? ''}`;
    void navigator.clipboard.writeText(text);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-overlay" role="alertdialog" aria-modal="true">
          <div className="error-boundary-modal">
            <h2 className="error-boundary-title">
              <i className="codicon codicon-warning" aria-hidden="true" />
              <span>Algo deu errado</span>
            </h2>
            <p className="error-boundary-msg">
              {this.state.error?.message || 'Erro desconhecido no renderer.'}
            </p>
            <details className="error-boundary-details">
              <summary>Stack trace</summary>
              <pre>{this.state.error?.stack}</pre>
              <pre>{this.state.info?.componentStack}</pre>
            </details>
            <div className="error-boundary-actions">
              <button
                type="button"
                className="error-boundary-btn error-boundary-btn-primary"
                onClick={this.handleReload}
              >
                Recarregar app
              </button>
              <button
                type="button"
                className="error-boundary-btn"
                onClick={this.handleContinue}
              >
                Tentar continuar
              </button>
              <button
                type="button"
                className="error-boundary-btn"
                onClick={this.handleCopyError}
              >
                Copiar erro
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
