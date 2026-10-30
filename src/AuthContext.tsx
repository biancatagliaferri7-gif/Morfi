import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient';

export type MorfiProfile = {
  id: string;
  full_name: string;
  phone: string | null;
  dni: string | null;
  enabled_panels: string[];
  seller_alias: string | null;
  seller_holder: string | null;
  seller_location: string | null;
  seller_directions: string | null;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  profile: MorfiProfile | null;
  refreshProfile: (userId?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MorfiProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  async function loadProfile(userId: string) {
    if (!supabase) return;
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (data.user?.id !== userId) {
      setProfile(null);
      return;
    }
    const metadata = data.user.user_metadata;
    setProfile({
      id: data.user.id,
      full_name: typeof metadata.full_name === 'string' ? metadata.full_name : '',
      phone: typeof metadata.phone === 'string' ? metadata.phone : null,
      dni: typeof metadata.dni === 'string' ? metadata.dni : null,
      enabled_panels: Array.isArray(metadata.enabled_panels)
        ? metadata.enabled_panels.filter((panel: unknown): panel is string => typeof panel === 'string')
        : [],
      seller_alias: typeof metadata.seller_alias === 'string' ? metadata.seller_alias : null,
      seller_holder: typeof metadata.seller_holder === 'string' ? metadata.seller_holder : null,
      seller_location: typeof metadata.seller_location === 'string' ? metadata.seller_location : null,
      seller_directions: typeof metadata.seller_directions === 'string' ? metadata.seller_directions : null,
    });
  }

  async function refreshProfile(userId?: string) {
    const targetUserId = userId ?? session?.user.id;
    if (!targetUserId) {
      setProfile(null);
      return;
    }
    await loadProfile(targetUserId);
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) console.error('No se pudo recuperar la sesión de MORFI:', error.message);
      if (!active) return;
      setSession(data.session);
      try {
        if (data.session) await loadProfile(data.session.user.id);
      } catch (profileError) {
        console.error('No se pudo cargar el perfil de MORFI:', profileError);
      } finally {
        if (active) setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setLoading(false);
        return;
      }
      window.setTimeout(() => {
        void loadProfile(nextSession.user.id).catch(error => {
          console.error('No se pudo cargar el perfil de MORFI:', error);
        }).finally(() => setLoading(false));
      }, 0);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: Boolean(supabase),
    loading,
    session,
    profile,
    refreshProfile,
    async signOut() {
      if (!supabase) throw new Error('Supabase no está configurado.');
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [loading, session, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return value;
}
