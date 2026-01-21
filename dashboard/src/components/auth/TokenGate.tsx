import { useState, useEffect, useCallback, type ReactNode, type FormEvent } from 'react';
import { Shield, AlertTriangle, Loader2 } from 'lucide-react';
import apiClient from '../../api/client';

interface TokenGateProps {
  children: ReactNode;
}

export default function TokenGate({ children }: TokenGateProps) {
  const [state, setState] = useState<'checking' | 'prompt' | 'authenticated'>('checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const verify = useCallback(async (tokenToVerify: string) => {
    // Temporarily set token so apiClient picks it up
    localStorage.setItem('agentsleak_token', tokenToVerify);
    try {
      await apiClient.fetchSessions(undefined, 1, 1);
      setState('authenticated');
      return true;
    } catch {
      localStorage.removeItem('agentsleak_token');
      return false;
    }
  }, []);

  // On mount: check if token exists and is valid, or if auth is even required
  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem('agentsleak_token');

      // First, check if auth is required at all (no token set on server)
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL || '/api'}/health`
        );
        if (res.ok) {
          // Health works — now test if sessions endpoint needs auth
          if (stored) {
            const ok = await verify(stored);
            if (ok) return;
          }
          // Try without any token
          try {
            await apiClient.fetchSessions(undefined, 1, 1);
            setState('authenticated');
            return;
          } catch {
            // Auth required, show prompt
            setState('prompt');
          }
        }
      } catch {
        // Server unreachable — skip gate so the app can show its own errors
        setState('authenticated');
      }
    })();
  }, [verify]);

  // Listen for auth_required events (fired when 401 is received)
  useEffect(() => {
    const handler = () => setState('prompt');
    window.addEventListener('agentsleak:auth_required', handler);
    return () => window.removeEventListener('agentsleak:auth_required', handler);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setError('');

    const ok = await verify(token.trim());
    if (!ok) {
      setError('Invalid token');
    }
    setLoading(false);
  };

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
      </div>
    );
  }

  if (state === 'authenticated') {
    return <>{children}</>;
  }

  // Prompt state
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Shield className="w-10 h-10 text-neutral-400 mb-3" />
          <h1 className="text-lg font-semibold text-neutral-100">AgentsLeak</h1>
          <p className="text-xs text-neutral-500 mt-1">Enter access token to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Access token"
              autoFocus
              className="w-full px-3 py-2 bg-[#141414] border border-neutral-800 rounded-md text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 font-mono"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full py-2 bg-neutral-100 text-neutral-900 text-sm font-medium rounded-md hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mx-auto animate-spin" />
            ) : (
              'Authenticate'
            )}
          </button>
        </form>

        <p className="text-[10px] text-neutral-600 text-center mt-6">
          Set AGENTSLEAK_DASHBOARD_TOKEN to enable authentication
        </p>
      </div>
    </div>
  );
}
