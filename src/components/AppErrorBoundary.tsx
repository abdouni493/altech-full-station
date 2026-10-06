/**
 * ─── Plus jamais de page blanche ───────────────────────────────────────────────
 * Une erreur de rendu démontait toute l'application et ne laissait qu'un écran
 * blanc après la connexion. Cette barrière l'attrape, affiche le message exact
 * et propose deux sorties : recharger, ou vider le cache local de ce navigateur
 * (copie des parties Magasin / Cafétéria / Restaurant) puis recharger — les
 * données en base ne sont jamais touchées.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React from 'react';

interface State { error: Error | null; stack: string }

export default class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack);
    this.setState({ stack: (info.componentStack || '').split('\n').filter(Boolean).slice(0, 6).join('\n') });
  }

  private clearCacheAndReload = () => {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('stationpro_') || k.startsWith('altech.'))
        .forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch { /* stockage indisponible */ }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'linear-gradient(135deg, #001233 0%, #003087 100%)' }}>
        <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-4">
          <h1 className="text-lg font-black text-[#002d87]">Une erreur a interrompu l'affichage</h1>
          <p className="text-sm text-slate-600">
            Vos données en base ne sont pas touchées. Essayez de recharger ; si l'erreur revient,
            videz le cache local de ce navigateur.
          </p>
          <pre className="text-[11px] bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto">
            {String(this.state.error?.message || this.state.error)}
            {this.state.stack ? `\n\n${this.state.stack}` : ''}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => window.location.reload()} className="btn-outline">Recharger</button>
            <button onClick={this.clearCacheAndReload} className="btn-primary">Vider le cache local et recharger</button>
          </div>
        </div>
      </div>
    );
  }
}
