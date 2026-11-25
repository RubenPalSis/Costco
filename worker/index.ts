import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  digest,
  syncOfficial,
  syncTelegram,
  sourceEnabled,
  type Env,
} from "./sync";
import { pushEndpoint, sendAlerts } from "./push";
import { publicPage } from "./html";
import { adminConfig } from "./admin";

const app = new Hono<{ Bindings: Env; Variables: { user: string } }>();
const api = app.basePath("/api/v1");
const stationSelect =
  "SELECT slug,official_id,name,city,province,region,postal_code,address,latitude,longitude,hours,active,created_at,updated_at FROM stations WHERE active=1";
const key = /^[a-z0-9-]{1,80}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const isoToday = () => new Date().toISOString().slice(0, 10);
const bad = (error: string) => ({ error });
const bounded = (raw: string | undefined, fallback: number, max: number) =>
  /^\d+$/.test(raw ?? "") ? Math.min(Number(raw), max) : fallback;
app.onError((_error, c) => c.json(bad("Error interno temporal"), 500));
app.notFound((c) => c.json(bad("Recurso inexistente"), 404));

api.use("*", async (c, next) => {
  if (["POST", "PATCH"].includes(c.req.method))
    return bodyLimit({
      maxSize: 8192,
      onError: (ctx) => ctx.json(bad("Solicitud demasiado grande"), 413),
    })(c, next);
  await next();
});
api.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (
    c.req.method !== "GET" ||
    /\/(admin|alerts|push)(\/|$)/.test(c.req.path) ||
    c.res.status !== 200
  ) {
    c.header("Cache-Control", "no-store");
    return;
  }
  const content = await c.res.clone().text();
  const tag = '"' + (await digest(content)) + '"';
  c.header(
    "Cache-Control",
    c.env.DEGRADED_MODE === "true"
      ? "public, max-age=900, stale-while-revalidate=600"
      : "public, max-age=120, stale-while-revalidate=300",
  );
  c.header("ETag", tag);
  if (c.req.header("if-none-match") === tag)
    c.res = new Response(null, { status: 304, headers: c.res.headers });
});

api.get("/stations", async (c) => {
  const limit = bounded(c.req.query("limit"), 100, 100),
    offset = bounded(c.req.query("offset"), 0, 1000);
  const rows = await c.env.DB.prepare(
    stationSelect + " ORDER BY city LIMIT ? OFFSET ?",
  )
    .bind(limit, offset)
    .all();
  return c.json({ data: rows.results, limit, offset });
});
api.get("/stations/:slug", async (c) => {
  const row = await c.env.DB.prepare(stationSelect + " AND slug=?")
    .bind(c.req.param("slug"))
    .first();
  return row
    ? c.json({ data: row })
    : c.json(bad("Estación no encontrada"), 404);
});
api.get("/prices", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        `SELECT p.*,f.name AS fuel_name,d.modality,d.url AS source_url, (SELECT MAX(o.published_at) FROM observations o
  WHERE o.station=p.station AND o.fuel=p.fuel AND o.source=p.source) AS verified_at
  FROM current_prices p JOIN data_sources d ON d.id=p.source JOIN fuel_types f ON f.id=p.fuel JOIN stations s ON s.slug=p.station AND s.active=1 ORDER BY p.station,p.fuel,p.source LIMIT 500`,
      ).all()
    ).results,
  }),
);
api.get("/prices/history", async (c) => {
  const station = c.req.query("station") ?? "",
    fuel = c.req.query("fuel") ?? "",
    source = c.req.query("source") ?? "telegram";
  const from =
      c.req.query("from") ??
      new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
    to = c.req.query("to") ?? isoToday();
  if (
    !key.test(station) ||
    !key.test(fuel) ||
    !["telegram", "official"].includes(source) ||
    !date.test(from) ||
    !date.test(to) ||
    from > to
  )
    return c.json(bad("Filtro inválido"), 400);
  const fromMs = Date.parse(from),
    toMs = Date.parse(to);
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    new Date(fromMs).toISOString().slice(0, 10) !== from ||
    new Date(toMs).toISOString().slice(0, 10) !== to
  )
    return c.json(bad("Fecha inválida"), 400);
  const until = new Date(Math.min(toMs + 86400000, Date.now())).toISOString();
  const since = new Date(fromMs).toISOString();
  const limit = Math.max(1, bounded(c.req.query("limit"), 366, 366)),
    offset = bounded(c.req.query("offset"), 0, 5000);
  const points = `WITH active_station AS (
       SELECT slug FROM stations WHERE slug=?1 AND active=1
     ), baseline AS (
       SELECT price, event FROM effective_observations
       WHERE station=(SELECT slug FROM active_station) AND fuel=?2 AND source=?3 AND published_at<?4
       ORDER BY published_at DESC, event DESC LIMIT 1
     ), points AS (
       SELECT station,fuel,source,event,published_at,price,1 AS actual FROM effective_observations
       WHERE station=(SELECT slug FROM active_station) AND fuel=?2 AND source=?3 AND published_at>=?4 AND published_at<?5
       UNION ALL
       SELECT ?1,?2,?3,event,?4,price,0 FROM baseline WHERE ?4<?5
     )`;
  const [rows, summary] = await c.env.DB.batch([
    c.env.DB.prepare(
      `${points}, history AS (
       SELECT *, LAG(price) OVER (ORDER BY published_at,actual,event) AS previous FROM points
     ) SELECT station,fuel,source,event,published_at,price,previous
       FROM history WHERE actual=1 AND (previous IS NULL OR price<>previous)
       ORDER BY published_at DESC,event DESC LIMIT ?6 OFFSET ?7`,
    ).bind(station, fuel, source, since, until, limit, offset),
    c.env.DB.prepare(
      `${points}, intervals AS (
       SELECT price, (unixepoch(LEAD(published_at,1,?5) OVER (ORDER BY published_at,actual,event)) - unixepoch(published_at)) AS seconds
       FROM points
     )
     SELECT SUM(price * seconds)*1.0/NULLIF(SUM(seconds),0) AS average,
       MIN(price) FILTER (WHERE seconds>0) AS minimum,
       MAX(price) FILTER (WHERE seconds>0) AS maximum,
       COALESCE(SUM(seconds),0) AS seconds,
       (SELECT price FROM baseline) AS baseline
     FROM intervals`,
    ).bind(station, fuel, source, since, until),
  ]);
  return c.json({
    data: rows.results,
    summary: summary.results[0],
    since,
    until,
    limit,
    offset,
  });
});
api.get("/prices/cheapest", async (c) => {
  const fuel = c.req.query("fuel") ?? "gas95",
    source = c.req.query("source") ?? "telegram";
  return c.json({
    data: await c.env.DB.prepare(
      "SELECT * FROM current_prices WHERE station IN (SELECT slug FROM stations WHERE active=1) AND fuel=? AND source=? ORDER BY price,station LIMIT 1",
    )
      .bind(fuel, source)
      .first(),
  });
});
api.get("/statistics", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT source,fuel,COUNT(*) AS count,MIN(price) AS minimum,MAX(price) AS maximum,ROUND(AVG(price)) AS average FROM current_prices WHERE station IN (SELECT slug FROM stations WHERE active=1) GROUP BY source,fuel",
      ).all()
    ).results,
  }),
);
api.get("/compare", async (c) => {
  const fuel = c.req.query("fuel") ?? "gas95";
  const station = c.req.query("station");
  if (station) {
    const radius = Number(c.req.query("radius") ?? "10");
    if (
      !key.test(station) ||
      !key.test(fuel) ||
      ![5, 10, 20, 50].includes(radius)
    )
      return c.json(bad("Filtro inválido"), 400);
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT * FROM nearby_prices WHERE station IN (SELECT slug FROM stations WHERE active=1) AND station=? AND fuel=? AND distance<=? AND verified_at>=? ORDER BY price,distance LIMIT 5",
        )
          .bind(
            station,
            fuel,
            radius,
            new Date(Date.now() - 72 * 3600000).toISOString(),
          )
          .all()
      ).results,
    });
  }
  const rows = await c.env.DB.prepare(
    "SELECT p.*,s.name FROM current_prices p JOIN stations s ON s.slug=p.station WHERE p.fuel=? AND s.active=1 ORDER BY p.source,p.price LIMIT 100",
  )
    .bind(fuel)
    .all();
  return c.json({ data: rows.results });
});
api.get("/status", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare("SELECT * FROM sync_state ORDER BY source").all()
    ).results,
    telegramEnabled: await sourceEnabled(c.env, "telegram"),
    officialEnabled: await sourceEnabled(c.env, "official"),
    pushKey: c.env.VAPID_PUBLIC_KEY ?? null,
  }),
);
api.get("/sources", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare("SELECT * FROM data_sources ORDER BY id").all()
    ).results,
  }),
);

function rawToken(value: string | undefined) {
  return value?.match(/^Bearer ([A-Za-z0-9-]{32,128})$/)?.[1];
}
api.use("/admin/*", async (c, next) => {
  const token = rawToken(c.req.header("authorization"));
  if (!c.env.ADMIN_TOKEN || !token)
    return c.json(bad("Acceso restringido"), 401);
  const [a, b] = await Promise.all([digest(token), digest(c.env.ADMIN_TOKEN)]);
  const different = Array.from(a).reduce(
    (value, char, index) => value | (char.charCodeAt(0) ^ b.charCodeAt(index)),
    0,
  );
  if (different) return c.json(bad("Acceso restringido"), 401);
  await next();
});
api.post("/admin/sync", async (c) => {
  const source = c.req.query("source") ?? "telegram";
  if (!["telegram", "official"].includes(source))
    return c.json(bad("Fuente desconocida"), 400);
  if (
    (source !== "telegram" && source !== "official") ||
    !(await sourceEnabled(c.env, source))
  )
    return c.json(bad("Fuente desactivada"), 409);
  const data =
    source === "telegram"
      ? await syncTelegram(c.env)
      : await syncOfficial(c.env);
  if (source === "telegram") await sendAlerts(c.env);
  await c.env.DB.prepare("INSERT INTO audit_logs(action) VALUES (?)")
    .bind("sync:" + source)
    .run();
  return c.json({ data });
});
api.post("/admin/import", async (c) => {
  if (c.env.DEGRADED_MODE === "true")
    return c.json(bad("Importación pausada para conservar cuota"), 503);
  if (!(await sourceEnabled(c.env, "telegram")))
    return c.json(bad("Fuente desactivada"), 409);
  const data = await syncTelegram(c.env, true);
  await c.env.DB.prepare(
    "INSERT INTO audit_logs(action) VALUES ('import:telegram')",
  ).run();
  return c.json({ data });
});
api.route("/admin/config", adminConfig);
api.get("/admin/overview", async (c) => {
  const [totals, state, messages, coverage] = await c.env.DB.batch<
    Record<string, unknown>
  >([
    c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM stations) AS stations,
      (SELECT COUNT(*) FROM price_history) AS changes,(SELECT COUNT(*) FROM telegram_messages) AS messages,
      (SELECT COUNT(*) FROM push_subscriptions) AS subscriptions,(SELECT COUNT(*) FROM notification_logs) AS recent_push`),
    c.env.DB.prepare("SELECT * FROM sync_state ORDER BY source"),
    c.env.DB.prepare(
      "SELECT id,published_at,updated_at FROM telegram_messages ORDER BY id DESC LIMIT 15",
    ),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS recent_provinces FROM official_province_sync WHERE last_success>=?",
    ).bind(new Date(Date.now() - 72 * 3600000).toISOString()),
  ]);
  return c.json({
    totals: { ...totals.results[0], ...coverage.results[0] },
    state: state.results,
    messages: messages.results,
  });
});
api.get("/admin/logs", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT * FROM synchronization_logs ORDER BY id DESC LIMIT 50",
      ).all()
    ).results,
  }),
);

api.post("/push/subscribe", async (c) => {
  if (
    !c.env.VAPID_PUBLIC_KEY ||
    !c.env.VAPID_PRIVATE_KEY ||
    !c.env.VAPID_SUBJECT
  )
    return c.json(bad("Notificaciones desactivadas"), 503);
  const token = rawToken(c.req.header("authorization"));
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return c.json(bad("Sesión inválida"), 401);
  if (
    !c.req.header("origin") ||
    c.req.header("origin") !== new URL(c.req.url).origin
  )
    return c.json(bad("Origen inválido"), 403);
  const input = await c.req.json().catch(() => null);
  if (
    !pushEndpoint(input?.endpoint) ||
    !/^[\w-]{87}$/.test(input?.keys?.p256dh ?? "") ||
    !/^[\w-]{22}$/.test(input?.keys?.auth ?? "")
  )
    return c.json(bad("Suscripción inválida"), 400);
  const hash = await digest(token);
  const user = await c.env.DB.prepare(
    "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>datetime('now')",
  )
    .bind(hash)
    .first<string>("user_id");
  if (user) return c.json({ data: { subscribed: true } });
  // Reserve capacity in the same transaction as the new subscription.
  const id = crypto.randomUUID();
  try {
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO users(id) SELECT ? WHERE (SELECT COUNT(*) FROM push_subscriptions)<250",
      ).bind(id),
      c.env.DB.prepare(
        "INSERT INTO sessions SELECT ?,id,datetime('now','+180 days') FROM users WHERE id=?",
      ).bind(hash, id),
      c.env.DB.prepare(
        "INSERT INTO push_subscriptions SELECT ?,id,?,? FROM users WHERE id=?",
      ).bind(input.endpoint, input.keys.p256dh, input.keys.auth, id),
    ]);
    return batch[2].meta.changes
      ? c.json({ data: { subscribed: true } }, 201)
      : c.json(bad("Capacidad de alertas alcanzada"), 429);
  } catch {
    return c.json(bad("Esta suscripción ya está registrada"), 409);
  }
});
const requireSession = (pattern: string) =>
  api.use(pattern, async (c, next) => {
    const token = rawToken(c.req.header("authorization"));
    const user =
      token &&
      (await c.env.DB.prepare(
        "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>datetime('now')",
      )
        .bind(await digest(token))
        .first<string>("user_id"));
    if (!user) return c.json(bad("Sesión inválida"), 401);
    c.set("user", user);
    await next();
  });
requireSession("/alerts");
requireSession("/alerts/*");
requireSession("/push/unsubscribe");
api.post("/push/unsubscribe", async (c) => {
  await c.env.DB.prepare("DELETE FROM users WHERE id=?")
    .bind(c.get("user"))
    .run();
  return c.json({ data: { subscribed: false } });
});
api.get("/alerts", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT * FROM price_alerts WHERE user_id=? ORDER BY created_at",
      )
        .bind(c.get("user"))
        .all()
    ).results,
  }),
);
api.post("/alerts", async (c) => {
  const input = await c.req.json().catch(() => null);
  if (!alertInput(input) || !key.test(input.station) || !key.test(input.fuel))
    return c.json(bad("Alerta inválida"), 400);
  const id = crypto.randomUUID(),
    user = c.get("user");
  const result = await c.env.DB.prepare(
    `INSERT INTO price_alerts(id,user_id,station,fuel,kind,threshold)
   SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM price_alerts WHERE user_id=?)<5
   AND EXISTS(SELECT 1 FROM stations WHERE slug=?) AND EXISTS(SELECT 1 FROM fuel_types WHERE id=?)`,
  )
    .bind(
      id,
      user,
      input.station,
      input.fuel,
      input.kind,
      input.threshold ?? null,
      user,
      input.station,
      input.fuel,
    )
    .run();
  return result.meta.changes
    ? c.json({ data: { id } }, 201)
    : c.json(
        bad(
          "Estación o combustible inválido, o límite de cinco alertas alcanzado",
        ),
        409,
      );
});
function alertInput(input: { kind: string; threshold?: number } | null) {
  return (
    !!input &&
    ["lower", "higher", "minimum", "threshold"].includes(input.kind) &&
    (input.kind !== "threshold" ||
      (Number.isInteger(input.threshold) &&
        input.threshold! >= 300 &&
        input.threshold! <= 5000))
  );
}
api.patch("/alerts/:id", async (c) => {
  const input = await c.req.json().catch(() => null);
  if (!alertInput(input)) return c.json(bad("Alerta inválida"), 400);
  const result = await c.env.DB.prepare(
    "UPDATE price_alerts SET kind=?,threshold=? WHERE id=? AND user_id=?",
  )
    .bind(input.kind, input.threshold ?? null, c.req.param("id"), c.get("user"))
    .run();
  return result.meta.changes
    ? c.json({ data: { id: c.req.param("id") } })
    : c.json(bad("Alerta inexistente"), 404);
});
api.delete("/alerts/:id", async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM price_alerts WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("id"), c.get("user"))
    .run();
  return result.meta.changes
    ? c.body(null, 204)
    : c.json(bad("Alerta inexistente"), 404);
});

app.get("/robots.txt", (c) =>
  c.text(
    c.env.PUBLIC_URL
      ? "User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: " +
          new URL("/sitemap.xml", c.env.PUBLIC_URL).href
      : "User-agent: *\nDisallow: /",
  ),
);
app.get("/sitemap.xml", async (c) => {
  if (!c.env.PUBLIC_URL) return c.text("URL pública pendiente", 404);
  const rows = await c.env.DB.prepare(
    "SELECT slug FROM stations WHERE active=1",
  ).all<{ slug: string }>();
  const paths = [
    "/",
    "/historico",
    "/comparador",
    "/calculadora",
    "/mapa",
    ...rows.results.map((r) => "/gasolineras/" + r.slug),
  ];
  const origin = new URL(c.env.PUBLIC_URL).origin;
  return c.body(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      paths
        .map((path) => "<url><loc>" + origin + path + "</loc></url>")
        .join("") +
      "</urlset>",
    200,
    { "Content-Type": "application/xml" },
  );
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const publicHtml =
      url.pathname === "/" ||
      /^\/gasolineras\/[a-z0-9-]{1,80}\/?$/.test(url.pathname);
    const cacheable =
      request.method === "GET" &&
      !request.headers.has("authorization") &&
      (publicHtml || !url.search) &&
      (publicHtml ||
        /^\/api\/v1\/(stations(?:\/[a-z0-9-]+)?|prices|status|sources)$/.test(
          url.pathname,
        ));
    const cacheKey = new Request(
      url.origin + url.pathname + (publicHtml ? "" : url.search),
    );
    const cache = cacheable ? await caches.open("ahorro-public-v1") : null;
    const conditional = request.headers.get("if-none-match");
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit)
        return conditional && hit.headers.get("etag") === conditional
          ? new Response(null, { status: 304, headers: hit.headers })
          : hit;
    }
    const response =
      publicHtml && env.ASSETS
        ? await publicPage(request, env)
        : await app.fetch(request, env, ctx);
    if (
      cache &&
      response.ok &&
      response.headers.get("Cache-Control")?.startsWith("public")
    )
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
  async scheduled(event: ScheduledController, env: Env) {
    if (event.cron === "7,27,47 * * * *") {
      if (
        (await sourceEnabled(env, "official")) &&
        (env.DEGRADED_MODE !== "true" ||
          new Date(event.scheduledTime).getUTCMinutes() === 7)
      )
        await syncOfficial(env).catch(() => null);
    } else if (event.cron === "28 5 * * *") {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM synchronization_logs WHERE created_at<datetime('now','-30 days')",
        ),
        env.DB.prepare(
          "DELETE FROM audit_logs WHERE created_at<datetime('now','-90 days')",
        ),
        env.DB.prepare(
          "DELETE FROM notification_logs WHERE created_at<datetime('now','-30 days')",
        ),
        env.DB.prepare(
          "DELETE FROM users WHERE id IN (SELECT user_id FROM sessions WHERE expires_at<=datetime('now'))",
        ),
      ]);
    } else if (
      (await sourceEnabled(env, "telegram")) &&
      (env.DEGRADED_MODE !== "true" ||
        new Date(event.scheduledTime).getUTCMinutes() === 0)
    ) {
      await syncTelegram(env).catch(() => null);
      await sendAlerts(env);
    }
  },
};
