import { type Env } from "./sync";
import { independenceNotice } from "../src/identity";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
type Station = {
  slug: string;
  name: string;
  city: string;
  address: string | null;
  hours: string | null;
  latitude: number | null;
  longitude: number | null;
};
type Price = {
  name: string;
  source: string;
  price: number;
  verified_at: string;
};

export async function publicPage(request: Request, env: Env) {
  const { pathname } = new URL(request.url);
  const slug = /^\/gasolineras\/([a-z0-9-]{1,80})\/?$/.exec(pathname)?.[1];
  const asset = await env.ASSETS.fetch(new URL("/index.html", request.url));
  if (!asset.ok) return asset;
  const stations = (
    await (
      slug
        ? env.DB.prepare(
            "SELECT slug,name,city,address,hours,latitude,longitude FROM stations WHERE active=1 AND official_id IS NULL AND slug=?",
          ).bind(slug)
        : env.DB.prepare(
            "SELECT slug,name,city,address,hours,latitude,longitude FROM stations WHERE active=1 AND official_id IS NULL ORDER BY city LIMIT 100",
          )
    ).all<Station>()
  ).results;
  const station = slug ? stations[0] : undefined;
  const title = station
    ? "Precios de combustible en " + station.name + " | AhorroCarburante"
    : slug
      ? "Gasolinera no encontrada | AhorroCarburante"
      : "Precios de combustible de Costco España | AhorroCarburante";
  const description = station
    ? "Consulta los precios, el horario y el histórico de " +
      station.name +
      " en " +
      station.city +
      "."
    : "Proyecto personal independiente de Costco para comparar precios de combustible en España.";
  const prices = station
    ? (
        await env.DB.prepare(
          `SELECT f.name,p.source,p.price,
      (SELECT MAX(o.published_at) FROM observations o WHERE o.station=p.station AND o.fuel=p.fuel AND o.source=p.source) AS verified_at
      FROM current_prices p JOIN fuel_types f ON f.id=p.fuel WHERE p.station=? AND p.source='telegram' ORDER BY p.source,p.fuel`,
        )
          .bind(station.slug)
          .all<Price>()
      ).results
    : [];
  const rows = prices
    .map(
      (p) =>
        "<li>" +
        escape(p.name) +
        " · " +
        (p.price / 1000).toFixed(3).replace(".", ",") +
        " €/L · " +
        "Socios, Telegram" +
        ' · <time datetime="' +
        escape(p.verified_at) +
        '">' +
        escape(p.verified_at.slice(0, 10)) +
        "</time></li>",
    )
    .join("");
  const list = stations
    .map(
      (s) =>
        '<li><a href="/gasolineras/' +
        escape(s.slug) +
        '">' +
        escape(s.name) +
        "</a></li>",
    )
    .join("");
  const content = station
    ? "<h1>" +
      escape(station.name) +
      "</h1><p>" +
      escape(station.address ?? station.city) +
      "</p>" +
      (station.hours ? "<p>" + escape(station.hours) + "</p>" : "") +
      (rows
        ? "<h2>Precios por litro</h2><ul>" + rows + "</ul>"
        : "<p>Sin precios verificados.</p>")
    : "<h1>" +
      escape(
        slug
          ? "Gasolinera no encontrada"
          : "Precios de combustible de Costco España",
      ) +
      "</h1>" +
      (list
        ? "<h2>Gasolineras</h2><ul>" + list + "</ul>"
        : "<p>Sin estaciones disponibles.</p>");
  const canonical = env.PUBLIC_URL
    ? new URL(pathname, env.PUBLIC_URL).href
    : "";
  const schema =
    station && canonical
      ? JSON.stringify({
          "@context": "https://schema.org",
          "@type": "GasStation",
          name: station.name,
          url: canonical,
          address: station.address
            ? {
                "@type": "PostalAddress",
                streetAddress: station.address,
                addressLocality: station.city,
                addressCountry: "ES",
              }
            : undefined,
          geo:
            station.latitude !== null && station.longitude !== null
              ? {
                  "@type": "GeoCoordinates",
                  latitude: station.latitude,
                  longitude: station.longitude,
                }
              : undefined,
        }).replace(/</g, "\\u003c")
      : "";
  const headers = new Headers(asset.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set(
    "Cache-Control",
    "public, max-age=120, stale-while-revalidate=300",
  );
  if (!canonical || (slug && !station)) headers.set("X-Robots-Tag", "noindex");
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on('meta[name="description"], meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on("head", {
      element(el) {
        el.append(
          (canonical
            ? '<link rel="canonical" href="' +
              escape(canonical) +
              '"><meta property="og:url" content="' +
              escape(canonical) +
              '">'
            : "") +
            '<meta name="twitter:card" content="summary"><meta name="twitter:title" content="' +
            escape(title) +
            '"><meta name="twitter:description" content="' +
            escape(description) +
            '">' +
            (schema
              ? '<script type="application/ld+json">' + schema + "</script>"
              : ""),
          { html: true },
        );
      },
    })
    .on("#root", {
      element(el) {
        el.setInnerContent(
          '<main class="shell"><nav aria-label="Navegación"><a href="/">Inicio</a><a href="/historico">Histórico</a><a href="https://t.me/costco_gasolineras">Ver precios en Telegram</a></nav>' +
            '<aside class="notice independence" aria-label="Proyecto independiente">' +
            escape(independenceNotice) +
            "</aside>" +
            content +
            '</main><footer class="shell"><p>Desarrollado por <a href="https://zetaweb.es/">zetaweb.es</a></p></footer>',
          { html: true },
        );
      },
    })
    .transform(
      new Response(asset.body, {
        status: slug && !station ? 404 : 200,
        headers,
      }),
    );
}
