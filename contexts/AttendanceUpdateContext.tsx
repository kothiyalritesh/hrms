import React, { createContext, useContext, useCallback } from "react";

interface AttendanceUpdateContextType {
  triggerAttendanceRefresh: () => void;
  onAttendanceUpdate: (callback: () => void) => () => void;
}

const AttendanceUpdateContext = createContext<AttendanceUpdateContextType | undefined>(undefined);

export function AttendanceUpdateProvider({ children }: { children: React.ReactNode }) {
  const [refreshTrigger, setRefreshTrigger] = React.useState(0);
  const listeners = React.useRef<Set<() => void>>(new Set());

  const triggerAttendanceRefresh = useCallback(() => {
    console.log("[ATTENDANCE UPDATE] Triggering global refresh");
    setRefreshTrigger((prev) => prev + 1);
    listeners.current.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error("[ATTENDANCE UPDATE] Error in listener:", error);
      }
    });
  }, []);

  const onAttendanceUpdate = useCallback((callback: () => void) => {
    listeners.current.add(callback);
    return () => {
      listeners.current.delete(callback);
    };
  }, []);

  return (
    <AttendanceUpdateContext.Provider value={{ triggerAttendanceRefresh, onAttendanceUpdate }}>
      {children}
    </AttendanceUpdateContext.Provider>
  );
}

export function useAttendanceUpdate() {
  const context = useContext(AttendanceUpdateContext);
  if (!context) {
    throw new Error("useAttendanceUpdate must be used within AttendanceUpdateProvider");
  }
  return context;
}
