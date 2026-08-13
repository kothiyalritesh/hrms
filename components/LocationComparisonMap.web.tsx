import React, { useEffect, useRef } from "react";
import { ThemedText } from "@/components/ThemedText";
import { loadGoogleMaps } from "@/utils/googleMapsLoader";
import {
  advancedMapOptions,
  loadAdvancedMarkerLibrary,
} from "@/utils/googleAdvancedMarkers";

type Props = {
  selected: { latitude: number; longitude: number; name: string };
  actual: { latitude: number; longitude: number; name: string };
  radiusMetres: number;
};

const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export default function LocationComparisonMap({
  selected,
  actual,
  radiusMetres,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!key || !ref.current) return;
    const render = async () => {
      if (!ref.current || !(window as any).google?.maps) return;
      const maps = (window as any).google.maps;
      const map = new maps.Map(ref.current, advancedMapOptions({
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      }));
      const { AdvancedMarkerElement, PinElement } =
        await loadAdvancedMarkerLibrary((window as any).google);
      const selectedPin = new PinElement({
        glyph: "S",
        background: "#2563EB",
        borderColor: "#ffffff",
        glyphColor: "#ffffff",
      });
      new AdvancedMarkerElement({
        map,
        position: { lat: selected.latitude, lng: selected.longitude },
        title: selected.name,
        content: selectedPin.element,
      });
      const actualPin = new PinElement({
        glyph: "A",
        background: "#F97316",
        borderColor: "#ffffff",
        glyphColor: "#ffffff",
      });
      new AdvancedMarkerElement({
        map,
        position: { lat: actual.latitude, lng: actual.longitude },
        title: actual.name,
        content: actualPin.element,
      });
      new maps.Circle({
        map,
        center: { lat: selected.latitude, lng: selected.longitude },
        radius: radiusMetres,
        strokeColor: "#16A34A",
        fillColor: "#16A34A",
        fillOpacity: 0.15,
      });
      new maps.Polyline({
        map,
        path: [
          { lat: selected.latitude, lng: selected.longitude },
          { lat: actual.latitude, lng: actual.longitude },
        ],
        strokeColor: "#7C3AED",
        strokeWeight: 3,
      });
      const bounds = new maps.LatLngBounds();
      bounds.extend({ lat: selected.latitude, lng: selected.longitude });
      bounds.extend({ lat: actual.latitude, lng: actual.longitude });
      map.fitBounds(bounds, 48);
    };
    void loadGoogleMaps().then(render).catch(() => undefined);
  }, [
    selected.latitude,
    selected.longitude,
    selected.name,
    actual.latitude,
    actual.longitude,
    actual.name,
    radiusMetres,
  ]);

  if (!key)
    return (
      <ThemedText style={{ color: "#B45309", padding: 12 }}>
        Map preview unavailable. Configure a restricted
        EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.
      </ThemedText>
    );
  return (
    <div
      ref={ref}
      aria-label="Map comparing selected site and actual location"
      style={{
        width: "100%",
        height: 240,
        borderRadius: 12,
        overflow: "hidden",
      }}
    />
  );
}
