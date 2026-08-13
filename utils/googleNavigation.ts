import { Linking } from "react-native";

type Coordinate = { latitude: number; longitude: number };

export function googleMapsDirectionsUrl(
  destination: Coordinate,
  origin?: Coordinate | null,
) {
  const params = [
    "api=1",
    `destination=${encodeURIComponent(
      `${destination.latitude},${destination.longitude}`,
    )}`,
    "travelmode=driving",
    "dir_action=navigate",
  ];
  if (origin) {
    params.push(
      `origin=${encodeURIComponent(`${origin.latitude},${origin.longitude}`)}`,
    );
  }
  return `https://www.google.com/maps/dir/?${params.join("&")}`;
}

export async function openGoogleMapsNavigation(
  destination: Coordinate,
  origin?: Coordinate | null,
) {
  return Linking.openURL(googleMapsDirectionsUrl(destination, origin));
}
