import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
