import { expect, test } from "@playwright/test";

const station = {
  slug: "getafe",
  name: "Costco Getafe",
  city: "Getafe",
  province: "Madrid",
  region: "Comunidad de Madrid",
  address: "Calle Agustín de Betancourt, 17",
  hours: "L-D: 06:00-23:00",
  latitude: 40.283111,
  longitude: -3.686667,
};
const price = {
  station: "getafe",
  fuel: "gas95",
  source: "telegram",
  price: 1200,
  previous: 1300,
  variation: -100,
  event: "1",
  published_at: "2026-11-24T09:10:02Z",
  source_url: "https://t.me/s/costco_gasolineras",
};
test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path.endsWith("/stations")
      ? { data: [station] }
      : path.endsWith("/prices") || path.endsWith("/history")
        ? { data: [price] }
        : path.endsWith("/status")
          ? {
              data: [],
              telegramEnabled: true,
              officialEnabled: false,
              pushKey: null,
            }
          : { data: [] };
    await route.fulfill({ json: payload });
  });
});
test("consulta precios y conserva favoritos al navegar", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Costco Getafe" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Guardar en favoritos" }).click();
  await page.goto("/favoritos");
  await expect(
    page.getByRole("button", { name: "Quitar de favoritos" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Costco Getafe" }).click();
  await expect(
    page.getByRole("heading", { name: "Costco Getafe", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Descargar CSV" }),
  ).toBeVisible();
});
test("calcula ahorro con cuota y desplazamiento", async ({ page }) => {
  await page.goto("/calculadora");
  await expect(page.getByText("Precio de socios")).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Otra gasolinera (€/L)" })
    .fill("1.5");
  await page
    .getByRole("spinbutton", { name: "Km extra de ida y vuelta" })
    .fill("20");
  await page.getByRole("spinbutton", { name: "Cuota anual (€)" }).fill("36");
  await expect(page.getByText("289,44")).toBeVisible();
});

test("el mapa muestra marcadores e indicaciones", async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/mapa");
  await page.locator(".leaflet-interactive").first().click();
  await expect(
    page.getByRole("link", { name: "Abrir indicaciones" }),
  ).toBeVisible();
});

test("el service worker muestra la página sin conexión", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBeTruthy();
  await context.setOffline(true);
  await page.goto("/calculadora");
  await expect(
    page.getByRole("heading", { name: "Estás sin conexión" }),
  ).toBeVisible();
});

test("compara medias históricas de dos estaciones", async ({ page }) => {
  await page.route("**/api/v1/stations", (route) =>
    route.fulfill({
      json: {
        data: [
          station,
          { ...station, slug: "las-rozas", name: "Costco Las Rozas" },
        ],
      },
    }),
  );
  await page.route("**/api/v1/prices/history?**", (route) => {
    const compared = new URL(route.request().url()).searchParams.get("station");
    const value = compared === "getafe" ? 1200 : 1300;
    return route.fulfill({
      json: {
        data: [{ ...price, station: compared, price: value }],
        since: "2026-11-23T00:00:00.000Z",
        until: "2026-11-25T00:00:00.000Z",
        summary: {
          average: value,
          minimum: value,
          maximum: value,
          baseline: value,
        },
      },
    });
  });
  await page.goto("/historico?station=getafe");
  await page
    .getByRole("combobox", { name: "Comparar con" })
    .selectOption("las-rozas");
  await expect(page.getByText("Media ponderada · Costco Getafe")).toBeVisible();
  await expect(
    page.getByText("Media ponderada · Costco Las Rozas"),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Descargar CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("historico-getafe.csv");
});

test("el aviso de independencia es visible en portada y aviso legal", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("complementary", { name: "Proyecto independiente" }),
  ).toContainText("no trabaja para Costco");
  await page.goto("/aviso-legal");
  await expect(page.getByText(/creado por iniciativa propia/)).toBeVisible();
  await expect(page.getByText(/ni respaldado por Costco/)).toBeVisible();
});
