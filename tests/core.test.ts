import { describe, expect, it } from "vitest";
import { milli, parseMessage } from "../worker/parser";
import { pushEndpoint } from "../worker/push";
import { distance } from "../worker/distance";
import { savings } from "../src/data";

describe("precios", () => {
  it("convierte las milésimas sin redondear el texto", () => {
    expect(milli("1,219")).toBe(1219);
    expect(milli("1.3")).toBe(1300);
    expect(milli("1.2050")).toBeNull();
  });
  it("interpreta la estructura observada en Telegram, con fecha UTC y modalidades explícitas", () => {
    const result = parseMessage(
      1391,
      "2026-11-24T09:10:02+00:00",
      "⛽ PRECIOS COMBUSTIBLE SOCIOS\nActualización: 24/11/2026 10:10\n\nROZAS DE MADRID (LAS) · Madrid\n⛽ Diesel Plus · 1.609 € ⬇️\n⛽ Gas95 E5 Plus · 1,369 €\n\nSESTAO · Bizkaia\n⛽ Gas98 E5 Plus · 1.509 €",
    );
    expect(result?.date).toBe("2026-11-24T09:10:02.000Z");
    expect(result?.quotes.map((p) => [p.station, p.fuel, p.price])).toEqual([
      ["las-rozas", "diesel", 1609],
      ["las-rozas", "gas95", 1369],
      ["sestao", "gas98", 1509],
    ]);
    expect(parseMessage(2, "2026-11-24", "Sin precios")).toBeNull();
  });
  it("descuenta desplazamiento y cuota exactamente una vez", () => {
    const result = savings(1.2, 1.5, 50, 6, 20, 2, 36);
    expect(result.trip).toBeCloseTo(1.44);
    expect(result.annual).toBeCloseTo(289.44);
    expect(result.breakEven).toBe(3);
  });
  it("calcula distancias en línea recta", () => {
    expect(distance(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
  });
  it("rechaza destinos Push ajenos y subdominios engañosos", () => {
    expect(pushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(
      pushEndpoint("https://fcm.googleapis.com.example.org/send/abc"),
    ).toBe(false);
    expect(pushEndpoint("http://fcm.googleapis.com/send/abc")).toBe(false);
  });
});
