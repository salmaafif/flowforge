/** Shape returned by POST /auth/login and kept for the session. */
export interface AuthUser {
  userId: string;
  tenantId: string;
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
}

export interface StoredAuth {
  accessToken: string;
  user: AuthUser;
}

const STORAGE_KEY = 'flowforge.auth';

export function loadAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}
