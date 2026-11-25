import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

let runtime: Miniflare;
const origin = "http://localhost";
const credentials = {
  authorization: "Bearer localtestingauthorizationonly123456",
};
const page = (
  quotes: string,
) => `<div class="tgme_widget_message" data-post="costco_gasolineras/100">
 <div class="tgme_widget_message_text">⛽ PRECIOS COMBUSTIBLE SOCIOS<br><br>GETAFE · Madrid<br>${quotes}</div>
 <a class="tgme_widget_message_date"><time datetime="2026-11-24T08:00:00Z">09:00</time></a></div>`;
beforeAll(async () => {
  const { outputFiles } = await build({
    stdin: {
      contents: `
    import app from './worker/index';
    import {syncTelegram, syncOfficial} from './worker/sync';
    export default {fetch(request,env,ctx) {
      const path=new URL(request.url).pathname;
      if(path==='/test/telegram') return syncTelegram(env,true,new Response(request.body)).then(x=>Response.json(x));
      if(path==='/test/official') return syncOfficial(env,new Response(request.body)).then(x=>Response.json(x));
      const headers=new Headers(request.headers);
      if(path.startsWith("/api") && !headers.has("authorization"))headers.set("authorization","Bypass-test-cache");
      return app.fetch(new Request(request,{headers}),env,ctx);
    }};
  `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
  });
  runtime = new Miniflare({
    modules: true,
    script: outputFiles[0].text,
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-30",
    bindings: { ADMIN_TOKEN: credentials.authorization.slice(7) },
  });
  const db = await runtime.getD1Database("DB");
  const sql = (
    await Promise.all(
      ["0001_initial.sql", "0002_locks.sql"].map((file) =>
        readFile("migrations/" + file, "utf8"),
      ),
    )
  ).join("\n");
  await db.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
});
afterAll(async () => {
  await runtime?.dispose();
});

describe("Worker y D1", () => {
  it("procesa HTML, deduplica y aplica correcciones al mismo mensaje", async () => {
    const ingest = async (html: string) =>
      runtime.dispatchFetch(origin + "/test/telegram", {
        method: "POST",
        body: html,
      });
    expect(
      await (await ingest(page("⛽ Gas95 E5 Plus · 1.209 €"))).json(),
    ).toMatchObject({ changed: 1 });
    // Use independent sync state between manual test batches.
    const db = await runtime.getD1Database("DB");
    await db
      .prepare("DELETE FROM sync_state WHERE source='telegram-history'")
      .run();
    expect(
      await (await ingest(page("⛽ Gas95 E5 Plus · 1.209 €"))).json(),
    ).toMatchObject({ changed: 0 });
    await db
      .prepare("DELETE FROM sync_state WHERE source='telegram-history'")
      .run();
    expect(
      await (await ingest(page("⛽ Gas95 E5 Plus · 1.229 €"))).json(),
    ).toMatchObject({ changed: 1 });
    const current = await runtime.dispatchFetch(origin + "/api/v1/prices");
    expect(await current.json()).toMatchObject({
      data: [{ station: "getafe", price: 1229, source: "telegram" }],
    });
    expect(
      (
        await runtime.dispatchFetch(origin + "/api/v1/prices", {
          headers: { "if-none-match": current.headers.get("etag")! },
        })
      ).status,
    ).toBe(304);
    expect(
      (await runtime.dispatchFetch(origin + "/api/v1/admin/logs")).status,
    ).toBe(401);
    expect(
      (
        await runtime.dispatchFetch(origin + "/api/v1/admin/logs", {
          headers: credentials,
        })
      ).status,
    ).toBe(200);
  });
  it.skipIf(
    !process.env.COSTCO_TELEGRAM_HTML || !process.env.COSTCO_OFFICIAL_JSON,
  )(
    "validación con respuestas reales descargadas localmente",
    async () => {
      const db = await runtime.getD1Database("DB");
      await db
        .prepare("DELETE FROM sync_state WHERE source='telegram-history'")
        .run();
      const telegram = await readFile(
        process.env.COSTCO_TELEGRAM_HTML!,
        "utf8",
      );
      const national = JSON.parse(
        await readFile(process.env.COSTCO_OFFICIAL_JSON!, "utf8"),
      );
      const regional = {
        ...national,
        ListaEESSPrecio: national.ListaEESSPrecio.filter(
          (row: { IDProvincia: string }) =>
            ["28", "29", "41", "48", "50"].includes(row.IDProvincia),
        ),
      };
      const t = await runtime.dispatchFetch(origin + "/test/telegram", {
        method: "POST",
        body: telegram,
      });
      expect(t.status).toBe(200);
      expect(((await t.json()) as { changed: number }).changed).toBeGreaterThan(
        10,
      );
      const o = await runtime.dispatchFetch(origin + "/test/official", {
        method: "POST",
        body: JSON.stringify(regional),
      });
      expect(o.status).toBe(200);
      expect(await o.json()).toMatchObject({ changed: 6 });
      const p = await runtime.dispatchFetch(origin + "/api/v1/prices");
      expect(await p.json()).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({ station: "getafe", source: "official" }),
          expect.objectContaining({
            station: "getafe",
            source: "telegram",
            price: 1219,
          }),
        ]),
      });
      const near = await runtime.dispatchFetch(
        origin + "/api/v1/compare?station=getafe&fuel=gas95&radius=10",
      );
      expect(
        ((await near.json()) as { data: unknown[] }).data.length,
      ).toBeGreaterThan(0);
    },
    25000,
  );
});
