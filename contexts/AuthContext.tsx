import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type UserRole = "employee" | "hr" | "manager" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  department?: string;
  avatar?: string;
  designation?: string;
  reportingManager?: string;
  joinDate?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = "@hrms_auth_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredUser();
  }, []);

  const loadStoredUser = async () => {
    try {
      const storedUser = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
    } catch (error) {
      console.error("Error loading user:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      let role: UserRole = "employee";
      if (email.toLowerCase().includes("admin")) {
        role = "admin";
      } else if (email.toLowerCase().includes("hr")) {
        role = "hr";
      } else if (email.toLowerCase().includes("manager")) {
        role = "manager";
      }

      const mockUser: User = {
        id: "user_" + Date.now(),
        email,
        name: email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        role,
        phone: "+91 9876543210",
        department: role === "admin" ? "Administration" : role === "hr" ? "Human Resources" : role === "manager" ? "Sales" : "Field Operations",
        designation: role === "admin" ? "Super Admin" : role === "hr" ? "HR Manager" : role === "manager" ? "Team Lead" : "Sales Executive",
        joinDate: "2023-06-15",
      };

      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(mockUser));
      setUser(mockUser);
      return true;
    } catch (error) {
      console.error("Login error:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      await AsyncStorage.multiRemove([
        "@hrms_attendance",
        "@hrms_leaves",
        "@hrms_tasks",
        "@hrms_notifications",
      ]);
      setUser(null);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const updateUser = async (userData: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...userData };
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
