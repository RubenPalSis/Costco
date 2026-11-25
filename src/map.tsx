import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { euros, maps, type Nearby, type Price, type Station } from "./data";

export default function FuelMap({
  stations,
  prices,
  nearby,
}: {
  stations: Station[];
  prices: Price[];
  nearby: Nearby[];
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { scrollWheelZoom: false }).setView(
      [40.2, -3.6],
      6,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const points: L.LatLngTuple[] = [];
    function marker(
      position: L.LatLngTuple,
      name: string,
      price: number | undefined,
      url: string,
    ) {
      points.push(position);
      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent =
        name + (price === undefined ? "" : " · " + euros(price / 1000) + "/L");
      const link = document.createElement("a");
      link.href = url;
      link.textContent = "Abrir indicaciones";
      link.target = "_blank";
      link.rel = "noreferrer";
      popup.appendChild(title);
      popup.appendChild(document.createElement("br"));
      popup.appendChild(link);
      L.circleMarker(position, {
        radius: 9,
        color: "#fff",
        weight: 2,
        fillColor: "#005a9c",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindPopup(popup);
    }
    for (const station of stations)
      if (station.latitude !== null && station.longitude !== null)
        marker(
          [station.latitude, station.longitude],
          station.name,
          prices.find((p) => p.station === station.slug)?.price,
          maps(station),
        );
    for (const station of nearby)
      marker(
        [station.latitude, station.longitude],
        station.name,
        station.price,
        "https://www.google.com/maps/search/?api=1&query=" +
          station.latitude +
          "," +
          station.longitude,
      );
    if (points.length)
      map.fitBounds(points, { padding: [24, 24], maxZoom: 13 });
    return () => {
      map.remove();
    };
  }, [stations, prices, nearby]);
  return (
    <div
      className="map-canvas"
      ref={container}
      aria-label="Mapa de gasolineras"
    />
  );
}
