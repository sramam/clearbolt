import { latLngToCell } from "h3-js";
import { US_STATE_CENTROIDS } from "./us-state-centroids.js";

export type ListingGeoEncoding = {
  locationLabel?: string;
  city?: string;
  state?: string;
  stateName?: string;
  latitude?: number;
  longitude?: number;
  /** H3 cell at resolution 7 (~neighborhood / city block scale when coords are good). */
  h3IndexRes7?: string;
  /** H3 cell at resolution 5 (~county scale; used when only state centroid is known). */
  h3IndexRes5?: string;
  /** How coordinates were derived. */
  geocodeSource?:
    | "json-ld"
    | "location-parse"
    | "state-centroid"
    | "city-jitter";
};

function hashCity(city: string): number {
  let h = 0;
  for (let i = 0; i < city.length; i++) {
    h = (h * 31 + city.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function parseCityState(location: string): { city?: string; state?: string } {
  const trimmed = location.trim();
  const comma = trimmed.lastIndexOf(",");
  if (comma === -1) return { city: trimmed || undefined };
  const city = trimmed.slice(0, comma).trim();
  const state = trimmed.slice(comma + 1).trim();
  return { city: city || undefined, state: state || undefined };
}

function resolveCoords(
  city: string | undefined,
  state: string | undefined,
  lat?: number,
  lng?: number,
): {
  lat: number;
  lng: number;
  source: ListingGeoEncoding["geocodeSource"];
} | null {
  if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    return { lat, lng, source: "json-ld" };
  }
  const stateKey = state?.trim();
  if (!stateKey) return null;
  const centroid =
    US_STATE_CENTROIDS[stateKey] ?? US_STATE_CENTROIDS[stateKey.toUpperCase()];
  if (!centroid) return null;
  if (city) {
    const h = hashCity(city.toLowerCase());
    const jitterLat = ((h % 100) - 50) / 50;
    const jitterLng = (((h >> 8) % 100) - 50) / 50;
    return {
      lat: centroid[0] + jitterLat,
      lng: centroid[1] + jitterLng,
      source: "city-jitter",
    };
  }
  return { lat: centroid[0], lng: centroid[1], source: "state-centroid" };
}

/** Encode listing geography for search colocation ([H3](https://h3geo.org/)). */
export function encodeListingGeo(input: {
  location?: string;
  city?: string;
  state?: string;
  stateName?: string;
  latitude?: number;
  longitude?: number;
}): ListingGeoEncoding | undefined {
  let city = input.city?.trim();
  let state = input.state?.trim();
  const stateName = input.stateName?.trim();
  const locationLabel = input.location?.trim();

  if (locationLabel && (!city || !state)) {
    const parsed = parseCityState(locationLabel);
    city = city ?? parsed.city;
    state = state ?? parsed.state;
  }

  if (!locationLabel && !city && !state && input.latitude == null) {
    return undefined;
  }

  const coords = resolveCoords(city, state, input.latitude, input.longitude);
  const geo: ListingGeoEncoding = {
    locationLabel:
      locationLabel ?? (city && state ? `${city}, ${state}` : undefined),
    city,
    state: state?.length === 2 ? state.toUpperCase() : state,
    stateName: stateName ?? (state && state.length > 2 ? state : undefined),
  };

  if (coords) {
    geo.latitude = coords.lat;
    geo.longitude = coords.lng;
    geo.geocodeSource = coords.source;
    geo.h3IndexRes7 = latLngToCell(coords.lat, coords.lng, 7);
    geo.h3IndexRes5 = latLngToCell(coords.lat, coords.lng, 5);
  }

  return geo;
}
