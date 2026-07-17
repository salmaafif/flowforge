import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ tenantSlug, email, password });
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong, try again');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 ' +
    'placeholder-slate-500 outline-none focus:border-sky-500';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-3xl font-bold tracking-tight text-slate-100">
          Flow<span className="text-sky-400">Forge</span>
        </h1>
        <p className="mb-8 text-center text-sm text-slate-400">Sign in to your tenant workspace</p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6"
        >
          <div>
            <label htmlFor="tenantSlug" className="mb-1 block text-sm text-slate-300">
              Tenant
            </label>
            <input
              id="tenantSlug"
              className={inputClass}
              placeholder="salma"
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              className={inputClass}
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              className={inputClass}
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sky-500 py-2 font-medium text-white transition
              hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
