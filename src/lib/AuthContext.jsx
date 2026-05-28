import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

const FLOOR_ROLES = ['kitchen', 'picker_packer', 'stock_controller', 'floor_operator'];

async function fetchUserProfile(session) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000); // 3s max for role lookup
    const { data: userProfile } = await supabase
      .from('users')
      .select('role, full_name, permissions')
      .eq('email', session.user.email)
      .abortSignal(controller.signal)
      .maybeSingle();
    clearTimeout(timer);

    if (userProfile) {
      return {
        id: session.user.id,
        email: session.user.email,
        full_name: userProfile.full_name || session.user.email.split('@')[0],
        role: userProfile.role,
        station: null,
        permissions: userProfile.permissions || '',
      };
    }
  } catch { /* table missing or network — fall through to default */ }

  // No user record — treat as admin (management users / bootstrap)
  return {
    id: session.user.id,
    email: session.user.email,
    full_name: session.user.email.split('@')[0],
    role: 'admin',
    station: null,
    permissions: '',
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState({ id: 'bypass', email: 'admin@leanliving.co.za', full_name: 'Admin', role: 'admin', station: null, permissions: [] });
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState({});

  // Attempt to recover a lost session — called on TOKEN_REFRESH_ERROR and on retry
  const tryRestoreSession = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const profile = await fetchUserProfile(session);
        setUser(profile);
        setSessionLost(false);
        return true;
      }
    } catch { /* network still down — keep banner visible */ }
    return false;
  }, []);

  useEffect(() => {
    let mounted = true;

    // Restore existing session on mount — 6s hard timeout prevents infinite spinner
    const authTimeout = setTimeout(() => {
      if (mounted) { setIsLoadingAuth(false); setAuthChecked(true); }
    }, 6000);

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      clearTimeout(authTimeout);
      if (session) {
        const profile = await fetchUserProfile(session);
        setUser(profile);
      }
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }).catch(() => {
      clearTimeout(authTimeout);
      if (mounted) { setIsLoadingAuth(false); setAuthChecked(true); }
    });

    // Listen for auth state changes (login/logout from any tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session) {
        const profile = await fetchUserProfile(session);
        setUser(profile);
        setAuthError(null);
        setSessionLost(false);
      } else if (event === 'TOKEN_REFRESHED' && session) {
        // Silent refresh succeeded — update user in case profile changed
        const profile = await fetchUserProfile(session);
        setUser(profile);
        setSessionLost(false);
      } else if (event === 'TOKEN_REFRESH_ERROR') {
        // Background refresh failed (network blip / extension blocking).
        // Don't log the user out — show a reconnect banner and retry every 30s.
        setSessionLost(true);
        const retry = setInterval(async () => {
          const restored = await tryRestoreSession();
          if (restored) clearInterval(retry);
        }, 30_000);
        // Clean up interval when component unmounts
        setTimeout(() => clearInterval(retry), 10 * 60 * 1000); // max 10 min of retries
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setSessionLost(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [tryRestoreSession]);

  const login = useCallback(async (email, password) => {
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const isAuthenticated = !!user;
  const isFloorUser = FLOOR_ROLES.includes(user?.role);
  const isLoadingPublicSettings = false;

  const navigateToLogin = useCallback(() => {
    window.location.href = '/login';
  }, []);

  const checkAppState = useCallback(async () => {}, []);
  const checkUserAuth = useCallback(async () => {}, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isFloorUser,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      sessionLost,
      tryRestoreSession,
      login,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
