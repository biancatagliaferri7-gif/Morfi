import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { pushOwner } from "./orders/pushStore";
import { disableOrderPush } from "./orders/pushService";
import { supabase } from "./lib/supabaseClient";

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
  isSeller: boolean;
  sellerSetupPending: boolean;
  refreshProfile: (userId?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MorfiProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  const [isSeller, setIsSeller] = useState(false);
  const [sellerSetupPending, setSellerSetupPending] = useState(false);
  const activeUser = useRef<string | null>(null);

  async function retainDeviceOwner(userId: string | null) {
    try {
      const owner = await pushOwner();
      if (activeUser.current === userId && owner !== userId)
        await pushOwner(null);
    } catch {
      /* No browser storage: background notices stay disabled. */
    }
  }

  async function loadProfile(userId: string) {
    if (!supabase) return;
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (data.user?.id !== userId) {
      if (activeUser.current !== userId) return;
      setProfile(null);
      setIsSeller(false);
      setSellerSetupPending(false);
      return;
    }
    const [profileResult, memberships, drafts] = await Promise.all([
      supabase
        .from("morfi_profiles")
        .select(
          "id,full_name,phone,dni,enabled_panels,seller_alias,seller_holder,seller_location,seller_directions",
        )
        .eq("id", userId)
        .single(),
      supabase
        .from("morfi_business_memberships")
        .select("business_id")
        .eq("user_id", userId)
        .in("role", ["owner", "manager"])
        .limit(1),
      supabase
        .from("morfi_seller_setup_drafts")
        .select("id")
        .eq("user_id", userId)
        .is("result_business_id", null)
        .is("parent_business_id", null)
        .limit(1),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (memberships.error) throw memberships.error;
    if (activeUser.current !== userId) return;
    setProfile(profileResult.data);
    setIsSeller(Boolean(memberships.data?.length));
    setSellerSetupPending(
      Boolean(drafts.data?.length) && !memberships.data?.length,
    );
  }

  async function refreshProfile(userId?: string) {
    const targetUserId = userId ?? session?.user.id;
    if (!targetUserId) {
      setProfile(null);
      setIsSeller(false);
      setSellerSetupPending(false);
      return;
    }
    await loadProfile(targetUserId);
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (error)
        console.error(
          "No se pudo recuperar la sesión de MORFI:",
          error.message,
        );
      if (!active) return;
      activeUser.current = data.session?.user.id ?? null;
      if (typeof indexedDB !== "undefined")
        void retainDeviceOwner(activeUser.current);
      setSession(data.session);
      try {
        if (data.session) await loadProfile(data.session.user.id);
      } catch (profileError) {
        console.error("No se pudo cargar el perfil de MORFI:", profileError);
      } finally {
        if (active) setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        if (activeUser.current !== nextSession?.user.id) {
          setProfile(null);
          setIsSeller(false);
          setSellerSetupPending(false);
          setLoading(Boolean(nextSession));
          if (typeof indexedDB !== "undefined")
            void retainDeviceOwner(nextSession?.user.id ?? null);
        }
        activeUser.current = nextSession?.user.id ?? null;
        if (!nextSession) {
          setProfile(null);
          setIsSeller(false);
          setSellerSetupPending(false);
          setLoading(false);
          return;
        }
        window.setTimeout(() => {
          if (activeUser.current !== nextSession.user.id) return;
          void loadProfile(nextSession.user.id)
            .catch((error) => {
              console.error("No se pudo cargar el perfil de MORFI:", error);
            })
            .finally(() => {
              if (activeUser.current === nextSession.user.id) setLoading(false);
            });
        }, 0);
      },
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: Boolean(supabase),
      loading,
      session,
      profile,
      isSeller,
      sellerSetupPending,
      refreshProfile,
      async signOut() {
        if (!supabase) throw new Error("Supabase no está configurado.");
        if (typeof indexedDB !== "undefined") await disableOrderPush();
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [loading, session, profile, isSeller, sellerSetupPending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de AuthProvider.");
  return value;
}
