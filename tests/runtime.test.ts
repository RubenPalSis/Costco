import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

let runtime: Miniflare;
const origin = "http://localhost";
const credentials = {
  authorization: "Bearer localtestingauthorizationonly123456",
};
const makeKey = () => {
  const jwk = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  }).privateKey.export({ format: "jwk" });
  return {
    publicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x!, "base64url"),
      Buffer.from(jwk.y!, "base64url"),
    ]).toString("base64url"),
    privateKey: jwk.d!,
  };
};
const sender = makeKey();
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
    import {sendAlerts} from './worker/push';
    import {syncTelegram} from './worker/sync';
    export default {fetch(request,env,ctx) {
      const path=new URL(request.url).pathname;
      if(path==='/test/deliver') {
        const requests=[];
        return sendAlerts(env,async (url,options)=>{
          const headers=new Headers(options.headers);
          requests.push({url,key:headers.get('authorization'),encoding:headers.get('content-encoding')});
          return new Response(null,{status:201});
        }).then(()=>Response.json(requests));
      }
      if(path==='/test/telegram') return syncTelegram(env,true,new Response(request.body)).then(x=>Response.json(x));
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
    bindings: {
      ADMIN_TOKEN: credentials.authorization.slice(7),
      VAPID_PUBLIC_KEY: sender.publicKey,
      VAPID_PRIVATE_KEY: sender.privateKey,
      VAPID_SUBJECT: "mailto:local-test@example.com",
    },
  });
  const db = await runtime.getD1Database("DB");
  const sql = (
    await Promise.all(
      [
        "0001_initial.sql",
        "0002_locks.sql",
        "0003_provincial_prices.sql",
        "0004_admin.sql",
      ].map((file) => readFile("migrations/" + file, "utf8")),
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
  it("calcula la media con el precio previo al rango aunque se paginen los cambios", async () => {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare(
        "INSERT INTO stations(slug,name,city,province) VALUES ('media','Media','Media','Madrid')",
      ),
      ...[
        ["1", "2026-10-31T00:00:00.000Z", 1000],
        ["2", "2026-11-01T06:00:00.000Z", 1400],
        ["3", "2026-11-01T12:00:00.000Z", 1400],
      ].map(([event, date, price]) =>
        db
          .prepare(
            "INSERT INTO observations VALUES ('media','gas95','telegram',?,?,?)",
          )
          .bind(event, date, price),
      ),
    ]);
    const response = await runtime.dispatchFetch(
      origin +
        "/api/v1/prices/history?station=media&fuel=gas95&from=2026-11-01&to=2026-11-01&limit=1",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ price: 1400, previous: 1000 }],
      summary: {
        average: 1300,
        baseline: 1000,
        minimum: 1000,
        maximum: 1400,
        seconds: 86400,
      },
    });
  });
  it("protege la edición y conserva la observación original y su auditoría", async () => {
    const path = origin + "/api/v1/admin/config";
    const body = JSON.stringify({
      action: "price",
      station: "media",
      fuel: "gas95",
      source: "telegram",
      event: "2",
      price: 1250,
      reason: "Verificado en la fuente",
    });
    const options = { method: "POST", body };
    expect((await runtime.dispatchFetch(path, options)).status).toBe(401);
    expect(
      (
        await runtime.dispatchFetch(path, {
          ...options,
          headers: { ...credentials, "content-type": "application/json" },
        })
      ).status,
    ).toBe(200);
    const rows = await runtime.dispatchFetch(
      path + "/observations?station=media&fuel=gas95&source=telegram",
      { headers: credentials },
    );
    expect(await rows.json()).toMatchObject({
      data: expect.arrayContaining([
        {
          event: "2",
          published_at: "2026-11-01T06:00:00.000Z",
          original: 1400,
          price: 1250,
        },
      ]),
    });
    const catalog = await runtime.dispatchFetch(path, { headers: credentials });
    expect(await catalog.json()).toMatchObject({
      audit: expect.arrayContaining([
        {
          action: expect.stringContaining("Verificado en la fuente"),
          created_at: expect.any(String),
        },
      ]),
    });
    const absent = await runtime.dispatchFetch(path, {
      ...options,
      body: body.replace('"event":"2"', '"event":"missing"'),
      headers: credentials,
    });
    expect(absent.status).toBe(404);
  });
  it("excluye estaciones y precios de la fuente retirada", async () => {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare(
        "INSERT INTO stations(slug,name,city,province,official_id) VALUES ('externa','Externa','Madrid','Madrid','123')",
      ),
      db.prepare(
        "INSERT INTO observations VALUES ('externa','gas95','official','1','2026-11-01T00:00:00.000Z',1000)",
      ),
    ]);
    const prices = await runtime.dispatchFetch(origin + "/api/v1/prices");
    expect(
      (
        (await prices.json()) as { data: { station: string; source: string }[] }
      ).data.every((p) => p.source === "telegram" && p.station !== "externa"),
    ).toBe(true);
    expect(
      (await runtime.dispatchFetch(origin + "/api/v1/stations/externa")).status,
    ).toBe(404);
  });
  it("registra un aviso, cifra Web Push y evita el segundo envío del mismo evento", async () => {
    const token = randomBytes(32).toString("hex");
    const headers = {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      origin,
    };
    const endpoint = "https://fcm.googleapis.com/fcm/send/local-test";
    const register = await runtime.dispatchFetch(
      origin + "/api/v1/push/subscribe",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          endpoint,
          keys: {
            p256dh: makeKey().publicKey,
            auth: randomBytes(16).toString("base64url"),
          },
        }),
      },
    );
    expect(register.status).toBe(201);
    const alert = await runtime.dispatchFetch(origin + "/api/v1/alerts", {
      method: "POST",
      headers,
      body: JSON.stringify({ station: "media", fuel: "gas95", kind: "lower" }),
    });
    expect(alert.status).toBe(201);
    const db = await runtime.getD1Database("DB");
    await db
      .prepare("UPDATE price_alerts SET created_at=datetime('now','-1 minute')")
      .run();
    await db
      .prepare(
        "INSERT INTO observations VALUES ('media','gas95','telegram','recent',?,1200)",
      )
      .bind(new Date(Date.now() - 30000).toISOString())
      .run();
    const response = await runtime.dispatchFetch(origin + "/test/deliver");
    expect(await response.json()).toMatchObject([
      {
        url: endpoint,
        key: expect.stringContaining("vapid"),
        encoding: "aes128gcm",
      },
    ]);
    expect(
      await (await runtime.dispatchFetch(origin + "/test/deliver")).json(),
    ).toEqual([]);
    const remove = await runtime.dispatchFetch(
      origin + "/api/v1/push/unsubscribe",
      { method: "POST", headers },
    );
    expect(remove.status).toBe(200);
  });
  it.skipIf(!process.env.COSTCO_BENCHMARK)(
    "mide una ráfaga local con 5000 observaciones archivadas",
    async () => {
      const db = await runtime.getD1Database("DB");
      await db.batch([
        db.prepare(
          "INSERT INTO stations(slug,name,city,province) VALUES ('bench','Bench','Bench','Madrid')",
        ),
        db.prepare(`WITH RECURSIVE days(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM days WHERE n<4999)
        INSERT INTO observations SELECT 'bench','gas95','telegram',printf('%05d',n),
          strftime('%Y-%m-%dT%H:%M:%fZ','2007-01-01','+'||n||' days'),1000+n%50 FROM days`),
      ]);
      const url =
        origin +
        "/api/v1/prices/history?station=bench&fuel=gas95&source=telegram&from=2020-01-01&to=2020-01-30";
      const latency: number[] = [];
      for (let batch = 0; batch < 10; batch++)
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            const start = performance.now();
            const response = await runtime.dispatchFetch(url);
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({
              summary: { seconds: 2592000 },
            });
            latency.push(performance.now() - start);
          }),
        );
      latency.sort((a, b) => a - b);
      console.info(
        "D1 local · 40 consultas / 4 concurrentes · mediana %d ms · p95 %d ms",
        Math.round(latency[19]),
        Math.round(latency[37]),
      );
    },
    20000,
  );
  it.skipIf(!process.env.COSTCO_TELEGRAM_HTML)(
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
      const t = await runtime.dispatchFetch(origin + "/test/telegram", {
        method: "POST",
        body: telegram,
      });
      expect(t.status).toBe(200);
      expect(((await t.json()) as { changed: number }).changed).toBeGreaterThan(
        10,
      );
      const p = await runtime.dispatchFetch(origin + "/api/v1/prices");
      expect(await p.json()).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({
            station: "getafe",
            source: "telegram",
            price: 1219,
          }),
        ]),
      });
    },
    25000,
  );
});
