import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '../api/client';
import { clearAuth, loadAuth, saveAuth } from './storage';
import type { StoredAuth } from './storage';

export interface LoginCredentials {
  tenantSlug: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  auth: StoredAuth | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadAuth());

  const login = useCallback(async (credentials: LoginCredentials) => {
    const result = await api<StoredAuth>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    saveAuth(result);
    setAuth(result);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  const value = useMemo(() => ({ auth, login, logout }), [auth, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
