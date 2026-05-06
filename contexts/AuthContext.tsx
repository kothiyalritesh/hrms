import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

export type UserRole =
  | "SYSTEM_ADMIN"
  | "ADMIN"
  | "BUSINESS_HEAD"
  | "TEAM_HEAD"
  | "TEAM_LEADER"
  | "VP_SALES"
  | "SALES_MANAGER"
  | "GM_SALES"
  | "AGM_SALES"
  | "HEAD_BUSINESS_DEVELOPMENT"
  | "BDM"
  | "BDM_SALES"
  | "SENIOR_BDE"
  | "BDE"
  | "SALES_EXECUTIVE"
  | "ASSOCIATE_BUSINESS_HEAD"
  | "ASSOCIATE_TEAM_HEAD"
  | "ASSOCIATE_SENIOR_BDM"
  | "ASSOCIATE_BDM"
  | "ASSOCIATE_BDE"
  | "ASSOCIATE_SALES_EXECUTIVE"
  | "ASSOCIATE_MANAGER"
  | "ASSOCIATE_SR_MANAGER"
  | "ASSOCIATE_GM_SALES"
  | "ASSOCIATE_AGM_SALES"
  | "CO-ORDINATOR"
  | "TELECALLER"
  | "SALES"
  | "DEPUTY_GENERAL_MANAGER"
  | "SENIOR_ASSOCIATE_BDM"
  | "VIDEO_EDITOR"
  | "WEB_DEVELOPER"
  | "DIGITAL_MARKETING_MANAGER"
  | "HR"
  | "HRD";

export interface User {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  role: UserRole;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  reports_to?: string | null;
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestOTP: (phone: string) => Promise<{ success: boolean }>;
  loginWithOTP: (phone: string, otp: string) => Promise<boolean>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  isDevMode: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const STORAGE_KEY = "@hrms_auth_user_v3"; // bumped to force re-login
const OTP_STORE_KEY = "@hrms_otp_store"; // { phone: otp, expires: timestamp }
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/** Send OTP via edumarcsms API */
async function sendSMSOTP(mobile: string, otp: string): Promise<void> {
  try {
    const message = encodeURIComponent(
      `Your verification code is : ${otp} Regards BOP REALTY`
    );
    const url =
      `https://smsapi.edumarcsms.com/api/v1/sendsms` +
      `?apikey=cliyfm0jy0002xnqx4w60excg` +
      `&senderId=REABOP` +
      `&message=${message}` +
      `&number=${mobile}` +
      `&templateId=1607100000000223009`;
    await fetch(url, { method: "GET", mode: "no-cors" }).catch(() => {});
  } catch {
    // SMS failure is silent — OTP still works via stored value
  }
}

/** Generate a 6-digit OTP string */
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredUser();
  }, []);

  const loadStoredUser = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setUser(JSON.parse(stored));
      }
    } catch (err) {
      console.error("Auth load error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const requestOTP = async (phone: string): Promise<{ success: boolean }> => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, is_active")
        .eq("phone", phone.trim())
        .eq("is_active", true)
        .single();

      if (error || !profile) return { success: false };

      // Special case: admin test number always gets 000000
      const otp = phone.trim() === "9999999999" ? "000000" : generateOTP();

      // Store OTP locally with expiry
      const store = JSON.parse((await AsyncStorage.getItem(OTP_STORE_KEY)) || "{}");
      store[phone.trim()] = { otp, expires: Date.now() + OTP_EXPIRY_MS };
      await AsyncStorage.setItem(OTP_STORE_KEY, JSON.stringify(store));

      // Send SMS (fire and forget)
      await sendSMSOTP(phone.trim(), otp);

      return { success: true };
    } catch {
      return { success: false };
    }
  };

  const loginWithOTP = async (phone: string, otp: string): Promise<boolean> => {
    try {
      // Validate OTP from local store
      const store = JSON.parse((await AsyncStorage.getItem(OTP_STORE_KEY)) || "{}");
      const entry = store[phone.trim()];

      if (!entry) return false;
      if (Date.now() > entry.expires) {
        delete store[phone.trim()];
        await AsyncStorage.setItem(OTP_STORE_KEY, JSON.stringify(store));
        return false;
      }
      if (otp.trim() !== entry.otp) return false;

      delete store[phone.trim()];
      await AsyncStorage.setItem(OTP_STORE_KEY, JSON.stringify(store));

      // Load profile
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("phone", phone.trim())
        .eq("is_active", true)
        .single();

      if (error || !profile) return false;

      // Sign in with Supabase using the profile ID as a custom token
      // This allows RLS policies to work with auth.uid()
      try {
        await supabase.auth.signInWithPassword({
          email: profile.email || `${phone.trim()}@hrms.local`,
          password: profile.id, // Use profile ID as password for custom auth
        });
      } catch (authErr) {
        // Auth might fail if user doesn't exist in auth table
        // Continue anyway - we'll use local auth
        console.warn("[Auth] Supabase auth sign-in failed:", authErr);
      }

      const userData: User = {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        role: (profile.role as UserRole) || "SALES_EXECUTIVE",
        status: profile.is_active ? "ACTIVE" : "INACTIVE",
        created_at: profile.created_at,
      };

      setUser(userData);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
      return true;
    } catch (err) {
      console.error("[loginWithOTP] Error:", err);
      return false;
    }
  };

  const login = async (phone: string, password: string): Promise<boolean> => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("phone", phone.trim())
        .eq("is_active", true)
        .single();

    if (error || !profile) {
        console.error("Login: user not found");
        return false;
      }

      // Password = custom_password if set, otherwise first word of name (lowercase)
      const expectedPassword = profile.custom_password || profile.name?.split(" ")[0]?.toLowerCase();
      if (password.trim() !== expectedPassword) {
        console.error("Login: wrong password");
        return false;
      }

      const userData: User = {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        role: (profile.role as UserRole) || "SALES_EXECUTIVE",
        status: profile.is_active ? "ACTIVE" : "INACTIVE",
        created_at: profile.created_at,
      };

      setUser(userData);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
      return true;
    } catch {
      return false;
    }
  };

  const logout = async () => {
    setUser(null);
    try {
      await supabase.auth.signOut();
    } catch {
      // silent
    }
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // silent
    }
  };

  const updateUser = async (data: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...data };
    setUser(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    try {
      await supabase.from("profiles").update(data).eq("id", user.id);
    } catch (e) {
      // silent fail
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        requestOTP,
        loginWithOTP,
        logout,
        updateUser,
        isDevMode: process.env.EXPO_PUBLIC_DEV_MODE === "true",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
