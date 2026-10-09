import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setAuthLostHandler } from '../../lib/apiClient.js';

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * status: 'loading' (checking for an existing session) | 'authenticated' | 'anonymous'
 * notice: 'expired' when a live session was lost, so the login page can explain why.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, notice: null });

  useEffect(() => {
    setAuthLostHandler(() => setState({ status: 'anonymous', user: null, notice: 'expired' }));
    // On first load the in-memory token is gone; recover it from the HttpOnly cookie if a session exists.
    refreshSession()
      .then(({ user }) => setState({ status: 'authenticated', user, notice: null }))
      .catch(() => setState({ status: 'anonymous', user: null, notice: null }));
    return () => setAuthLostHandler(() => {});
  }, []);

  const adopt = useCallback((data) => {
    setAccessToken(data.accessToken);
    setState({ status: 'authenticated', user: data.user, notice: null });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      async login(email, password) {
        adopt(await api('/auth/login', { method: 'POST', body: { email, password }, auth: false }));
      },
      async register(input) {
        adopt(await api('/auth/register', { method: 'POST', body: input, auth: false }));
      },
      async logout() {
        try {
          await api('/auth/logout', { method: 'POST', auth: false });
        } catch {
          /* even if the server is unreachable, drop the local session */
        }
        setAccessToken(null);
        setState({ status: 'anonymous', user: null, notice: null });
      },
      async logoutAll() {
        await api('/auth/logout-all', { method: 'POST' });
        setAccessToken(null);
        setState({ status: 'anonymous', user: null, notice: null });
      },
      async updateProfile(changes) {
        const { user } = await api('/me', { method: 'PATCH', body: changes });
        setState((s) => ({ ...s, user }));
      },
      changePassword: (currentPassword, newPassword) =>
        api('/me/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
    }),
    [state, adopt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
