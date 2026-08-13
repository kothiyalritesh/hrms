// utils/medianBridge.ts
// Median (GoNative) JavaScript Bridge for native location + background tracking
// Docs: https://median.co/docs/javascript-bridge

export const isMedian = (): boolean => {
  return typeof (window as any).median !== "undefined" ||
    typeof (window as any).gonative !== "undefined";
};

// Request location permission via Median native bridge
export async function medianRequestLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  capturedAt?: string;
} | null> {
  if (!isMedian()) return null;

  const bridge = (window as any).median || (window as any).gonative;

  // Try Median's native geolocation bridge
  if (bridge?.geolocation?.getCurrentPosition) {
    return new Promise((resolve) => {
      // Register a named global callback — Median calls it by name as a string
      const cbName = "__medianLocCb_" + Date.now();
      const timer = setTimeout(() => {
        delete (window as any)[cbName];
        resolve(null);
      }, 20000);

      (window as any)[cbName] = (pos: any) => {
        clearTimeout(timer);
        delete (window as any)[cbName];
        const latitude = Number(pos?.latitude ?? pos?.coords?.latitude);
        const longitude = Number(pos?.longitude ?? pos?.coords?.longitude);
        const accuracy = Number(pos?.accuracy ?? pos?.coords?.accuracy);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          resolve({
            latitude,
            longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
            capturedAt: new Date(
              Number(pos?.timestamp) || Date.now(),
            ).toISOString(),
          });
        } else {
          resolve(null);
        }
      };

      bridge.geolocation.getCurrentPosition({
        callback: cbName,          // Median expects a string name of a global function
        highAccuracy: true,        // Median-specific flag
        maximumAge: 0,
        timeout: 15000,
      });
    });
  }

  // Fallback: WebView navigator.geolocation with high accuracy
  if (navigator?.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            capturedAt: new Date(p.timestamp).toISOString(),
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  return null;
}

// Start Median background location tracking
// Median will call window.medianLocationCallback(lat, lng) on each update
export function medianStartBackgroundLocation(
  onLocation: (lat: number, lng: number) => void
) {
  if (!isMedian()) return;

  // Register the callback Median will call
  (window as any).medianLocationCallback = (lat: number, lng: number) => {
    onLocation(lat, lng);
  };

  const bridge = (window as any).median || (window as any).gonative;
  bridge?.geolocation?.start?.({
    interval: 300000,      // 5 minutes in ms
    highAccuracy: true,    // Median-specific flag for GPS chip
    maximumAge: 0,
    callback: "medianLocationCallback",
  });
}

export function medianStopBackgroundLocation() {
  if (!isMedian()) return;
  const bridge = (window as any).median || (window as any).gonative;
  bridge?.geolocation?.stop?.();
  delete (window as any).medianLocationCallback;
}
