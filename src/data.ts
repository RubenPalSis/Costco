export const brand = { name: "AhorroCarburante", contact: "", operator: "" };
export const fuels: Record<string, string> = {
  gas95: "Gasolina 95",
  diesel: "Diésel Plus",
  gas98: "Gasolina 98",
  "diesel-a": "Gasóleo A",
};
export type Station = {
  slug: string;
  name: string;
  city: string;
  province: string;
  region: string | null;
  address: string | null;
  hours: string | null;
  latitude: number | null;
  longitude: number | null;
};
export type Price = {
  station: string;
  fuel: string;
  fuel_name?: string;
  source: string;
  price: number;
  previous: number | null;
  variation: number | null;
  published_at: string;
  verified_at?: string;
  event: string;
};
export type Nearby = {
  official_id: string;
  name: string;
  address: string;
  price: number;
  distance: number;
  latitude: number;
  longitude: number;
  verified_at: string;
};
export type Status = {
  data: {
    source: string;
    last_success: string | null;
    failures: number;
    next_attempt?: string | null;
  }[];
  telegramEnabled: boolean;
  pushKey: string | null;
};
export const euros = (value: number, digits = 3) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
export const stamp = (date: string) =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch("/api/v1" + path, options);
  if (res.status === 204) return undefined as T;
  const result = await res.json<T & { error?: string }>().catch(() => null);
  if (!res.ok || !result)
    throw new Error(result?.error ?? "No se pudo conectar con los datos");
  return result;
}
export const maps = (station: Station) =>
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(
    station.latitude !== null && station.longitude !== null
      ? station.latitude + "," + station.longitude
      : station.name + " " + station.province,
  );
export function savings(
  costco: number,
  other: number,
  liters: number,
  consumption: number,
  km: number,
  fills: number,
  membership: number,
) {
  const perFill = (other - costco) * liters;
  const trip = ((km * consumption) / 100) * costco;
  const net = perFill - trip;
  return {
    perFill,
    trip,
    net,
    monthly: net * fills,
    annual: net * fills * 12 - membership,
    breakEven: net > 0 ? Math.ceil(membership / net) : null,
    maxDistance:
      consumption > 0 && costco > 0
        ? Math.max(0, perFill / ((consumption / 100) * costco))
        : null,
  };
}
