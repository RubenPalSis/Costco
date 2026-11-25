import type { Env } from "./sync";
import { independenceNotice, legal, navigation } from "../src/identity";

const pages: Record<string, [string, string]> = {
  "/": [
    "Precios por estación",
    "Consulta los precios de combustible para socios de Costco en España.",
  ],
  "/historico": [
    "Histórico de precios",
    "Consulta cuándo cambiaron los precios de gasolina y diésel en las estaciones Costco de España.",
  ],
  "/calculadora": [
    "Calculadora de ahorro",
    "Calcula cuánto puedes ahorrar al repostar en Costco, incluyendo el desplazamiento y la cuota de socio.",
  ],
  "/favoritos": [
    "Favoritos",
    "Guarda tus estaciones Costco en este navegador y vuelve rápidamente a su histórico.",
  ],
  "/aviso-legal": ["Aviso legal", independenceNotice],
  "/privacidad": [
    "Política de privacidad",
    "El tema y tus estaciones favoritas se guardan en este navegador. Cloudflare sirve la web y sus datos.",
  ],
  "/cookies": [
    "Política de cookies",
    "El sitio usa almacenamiento local para recordar la apariencia y tus favoritos.",
  ],
  "/condiciones": [
    "Condiciones de uso",
    "Los precios son orientativos. Comprueba en la estación el importe y las condiciones comerciales antes de repostar.",
  ],
  "/contacto": [
    "Contacto",
    "Información de contacto del proyecto independiente AhorroCarburante.",
  ],
  "/fuentes": [
    "Fuentes de información",
    "El proyecto publica los precios de combustible autorizados para socios de Costco en España.",
  ],
  "/sobre-nosotros": ["Sobre nosotros", independenceNotice],
};
export const indexablePaths = Object.keys(pages).filter(
  (path) => path !== "/favoritos",
);
export const hasPublicPage = (path: string) => Object.hasOwn(pages, path);
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const amount = (price: number) =>
  (price / 1000).toFixed(3).replace(".", ",") + " €/L";
const navLinks = navigation
  .map(([path, label]) => `<a href="${path}">${label}</a>`)
  .join("");
const legalLinks = legal
  .map(([path, label]) => `<a href="/${path}">${label}</a>`)
  .join("");

export async function publicPage(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  let [title, description] = pages[path];
  const asset = await env.ASSETS.fetch(new URL("/index.html", request.url));
  if (!asset.ok) return asset;
  const canonical = new URL(path, env.PUBLIC_URL || url.origin);
  let detail = "";
  let invalidStation = false;
  if (path === "/") {
    const { results } = await env.DB.prepare(
      `SELECT s.slug,s.name,f.name AS fuel,p.price FROM current_prices p
       JOIN stations s ON s.slug=p.station JOIN fuel_types f ON f.id=p.fuel
       WHERE p.source='telegram' AND s.active=1 AND s.official_id IS NULL ORDER BY s.city,p.fuel LIMIT 100`,
    ).all<{ slug: string; name: string; fuel: string; price: number }>();
    const stations = new Map<string, { name: string; prices: string[] }>();
    for (const row of results) {
      if (!stations.has(row.slug))
        stations.set(row.slug, { name: row.name, prices: [] });
      stations
        .get(row.slug)!
        .prices.push(`<li>${escape(row.fuel)} · ${amount(row.price)}</li>`);
    }
    detail = `<div class="cards">${[...stations]
      .map(
        ([slug, station]) =>
          `<article class="panel station-card"><h2>${escape(station.name)}</h2><ul>${station.prices.join("")}</ul><a href="/historico?station=${encodeURIComponent(slug)}">Ver histórico de ${escape(station.name)}</a></article>`,
      )
      .join("")}</div>`;
  } else if (path === "/historico") {
    const selected = url.searchParams.get("station");
    if (selected && /^[a-z0-9-]{1,80}$/.test(selected)) {
      const station = await env.DB.prepare(
        "SELECT name FROM stations WHERE slug=? AND active=1 AND official_id IS NULL",
      )
        .bind(selected)
        .first<string>("name");
      if (station) {
        canonical.searchParams.set("station", selected);
        title = "Histórico de precios de " + station;
        description =
          "Consulta los últimos cambios de precio de los combustibles de " +
          station +
          ".";
        const { results } = await env.DB.prepare(
          `SELECT h.published_at,h.price,f.name AS fuel FROM price_history h JOIN fuel_types f ON f.id=h.fuel
           WHERE h.source='telegram' AND h.station=? ORDER BY h.published_at DESC,h.event DESC,h.fuel LIMIT 10`,
        )
          .bind(selected)
          .all<{ published_at: string; price: number; fuel: string }>();
        detail =
          "<ul>" +
          results
            .map(
              (row) =>
                `<li><time datetime="${escape(row.published_at)}">${escape(row.published_at.slice(0, 10))}</time> · ${escape(row.fuel)} · ${amount(row.price)}</li>`,
            )
            .join("") +
          "</ul>";
      }
    } else {
      const { results } = await env.DB.prepare(
        "SELECT slug,name FROM stations WHERE active=1 AND official_id IS NULL ORDER BY city LIMIT 100",
      ).all<{ slug: string; name: string }>();
      detail =
        "<ul>" +
        results
          .map(
            (station) =>
              `<li><a href="/historico?station=${encodeURIComponent(station.slug)}">${escape(station.name)}</a></li>`,
          )
          .join("") +
        "</ul>";
    }
  }
  if (
    path === "/historico" &&
    url.searchParams.has("station") &&
    !canonical.searchParams.has("station")
  )
    invalidStation = true;
  const headers = new Headers(asset.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set(
    "Cache-Control",
    "public, max-age=120, stale-while-revalidate=300",
  );
  if (!env.PUBLIC_URL || path === "/favoritos")
    headers.set("X-Robots-Tag", "noindex");
  if (invalidStation) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex");
  }
  const documentTitle =
    (path === "/" ? "Precios de gasolina y diésel Costco en España" : title) +
    " | AhorroCarburante";
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(documentTitle);
      },
    })
    .on('meta[name="description"], meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", documentTitle);
      },
    })
    .on("head", {
      element(el) {
        el.append(
          `<link rel="canonical" href="${escape(canonical.href)}"><meta property="og:url" content="${escape(canonical.href)}">`,
          { html: true },
        );
      },
    })
    .on("#root", {
      element(el) {
        el.setInnerContent(
          `<main class="shell"><nav aria-label="Navegación">${navLinks}</nav>
      <aside class="notice independence" aria-label="Proyecto independiente">${independenceNotice}</aside>
      <h1>${escape(title)}</h1><p>${escape(description)}</p>${detail}</main>
      <footer class="site-footer"><div class="shell footer-grid"><div class="footer-intro"><a class="brand" href="/">AhorroCarburante</a><p>Precios de combustible para socios de Costco en España.</p></div>
      <nav aria-label="Explorar el sitio"><h2>Explorar</h2>${navLinks}</nav><nav aria-label="Información del sitio"><h2>Información</h2>${legalLinks}</nav></div>
      <div class="shell footer-bottom"><p>Proyecto personal e independiente de Costco.</p><p>Desarrollado por <a href="https://zetaweb.es/">zetaweb.es</a></p></div></footer>`,
          { html: true },
        );
      },
    })
    .transform(new Response(asset.body, { headers }));
}
