import type { Env } from "./sync";
import { independenceNotice } from "../src/identity";

export async function publicPage(request: Request, env: Env) {
  const asset = await env.ASSETS.fetch(new URL("/index.html", request.url));
  if (!asset.ok) return asset;
  const headers = new Headers(asset.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set(
    "Cache-Control",
    "public, max-age=120, stale-while-revalidate=300",
  );
  if (!env.PUBLIC_URL) headers.set("X-Robots-Tag", "noindex");
  return new HTMLRewriter()
    .on("#root", {
      element(el) {
        el.setInnerContent(
          `<main class="shell"><nav aria-label="Navegación"><a href="/historico">Histórico</a><a href="/calculadora">Calculadora</a><a href="/favoritos">Favoritos</a></nav>
          <aside class="notice independence" aria-label="Proyecto independiente">${independenceNotice}</aside>
          <h1>Precios por estación</h1><p>Consulta los precios de combustible para socios de Costco.</p></main>
          <footer class="shell"><p>Desarrollado por <a href="https://zetaweb.es/">zetaweb.es</a></p></footer>`,
          { html: true },
        );
      },
    })
    .transform(new Response(asset.body, { headers }));
}
