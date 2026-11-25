export function distance(
  lat: number,
  lon: number,
  otherLat: number,
  otherLon: number,
) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((otherLat - lat) * rad) / 2) ** 2 +
    Math.cos(lat * rad) *
      Math.cos(otherLat * rad) *
      Math.sin(((otherLon - lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}
