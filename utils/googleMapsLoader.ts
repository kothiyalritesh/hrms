let mapsPromise: Promise<any> | null = null;

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Google Maps JS is available only on web"));
  }
  const existingGoogle = (window as any).google?.maps;
  if (existingGoogle) return Promise.resolve(existingGoogle);
  if (mapsPromise) return mapsPromise;

  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (!key)
    return Promise.reject(new Error("Google Maps key is not configured"));

  mapsPromise = new Promise((resolve, reject) => {
    const callback = "__realty_hrms_google_maps_ready";
    const timeout = window.setTimeout(() => {
      delete (window as any)[callback];
      mapsPromise = null;
      reject(new Error("Google Maps failed to load"));
    }, 20_000);
    (window as any)[callback] = () => {
      window.clearTimeout(timeout);
      delete (window as any)[callback];
      resolve((window as any).google.maps);
    };

    const prior = document.getElementById("realty-hrms-google-maps");
    if (prior) prior.remove();
    const script = document.createElement("script");
    script.id = "realty-hrms-google-maps";
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(key)}` +
      `&libraries=places,marker&loading=async&callback=${callback}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      delete (window as any)[callback];
      script.remove();
      mapsPromise = null;
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}
