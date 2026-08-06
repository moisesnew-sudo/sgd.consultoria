import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../types';
import { authApi } from '../services/api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (keys: string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    authApi.getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const hasPermission = useCallback((key: string): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (!user.permissions) return false;
    return user.permissions.includes(key);
  }, [user]);

  const hasAnyPermission = useCallback((keys: string[]): boolean => {
    return keys.some(k => hasPermission(k));
  }, [hasPermission]);

  const refreshPermissions = async () => {
    try {
      const me = await authApi.getMe();
      setUser(prev => prev ? { ...prev, ...me } : me);
    } catch {
      // ignore
    }
  };

  const login = async (email: string, password: string) => {
    const data = await authApi.login(email, password);
    setUser(data.user);
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated: !!user, 
      isLoading,
      hasPermission,
      hasAnyPermission,
      login, 
      logout,
      refreshPermissions
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
