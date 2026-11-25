import { Hono } from "hono";
import { slugify } from "./parser";
import { type Env } from "./sync";

export const adminConfig = new Hono<{ Bindings: Env }>();
const validKey = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9-]{1,80}$/.test(value);
const shortText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

adminConfig.get("/", async (c) => {
  const [stations, fuels, aliases, settings, audit, corrections] =
    await c.env.DB.batch([
      c.env.DB.prepare(
        "SELECT slug,name,active FROM stations ORDER BY name LIMIT 100",
      ),
      c.env.DB.prepare("SELECT id,name FROM fuel_types ORDER BY id"),
      c.env.DB.prepare(
        "SELECT alias,station FROM station_aliases ORDER BY alias LIMIT 200",
      ),
      c.env.DB.prepare(
        "SELECT key,value FROM application_settings WHERE key IN ('pause:telegram','pause:official')",
      ),
      c.env.DB.prepare(
        "SELECT action,created_at FROM audit_logs ORDER BY id DESC LIMIT 30",
      ),
      c.env.DB.prepare(
        "SELECT station,fuel,source,event,price,reason,corrected_at FROM price_corrections ORDER BY corrected_at DESC LIMIT 30",
      ),
    ]);
  return c.json({
    stations: stations.results,
    fuels: fuels.results,
    aliases: aliases.results,
    settings: settings.results,
    audit: audit.results,
    corrections: corrections.results,
  });
});
adminConfig.get("/observations", async (c) => {
  const station = c.req.query("station"),
    fuel = c.req.query("fuel"),
    source = c.req.query("source");
  if (
    !validKey(station) ||
    !validKey(fuel) ||
    (source !== "telegram" && source !== "official")
  )
    return c.json({ error: "Filtros de observación inválidos" }, 400);
  const rows = await c.env.DB.prepare(
    `SELECT o.event,o.published_at,o.price original,e.price
     FROM observations o JOIN effective_observations e USING(station,fuel,source,event)
     WHERE o.station=? AND o.fuel=? AND o.source=? ORDER BY o.published_at DESC,o.event DESC LIMIT 30`,
  )
    .bind(station, fuel, source)
    .all();
  return c.json({ data: rows.results });
});
adminConfig.post("/", async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!input || !shortText(input.reason, 300))
    return c.json({ error: "Indica un motivo de hasta 300 caracteres" }, 400);
  const db = c.env.DB;
  const { action, station, fuel, source, event, price, active, name, paused } =
    input;
  let statement: D1PreparedStatement;
  switch (action) {
    case "station":
      if (
        !validKey(station) ||
        !shortText(name, 100) ||
        typeof active !== "boolean"
      )
        return c.json({ error: "Estación, nombre o estado inválidos" }, 400);
      statement = db
        .prepare(
          "UPDATE stations SET name=?,name_override=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE slug=?",
        )
        .bind(name.trim(), name.trim(), active ? 1 : 0, station);
      break;
    case "alias": {
      const alias = typeof input.alias === "string" ? slugify(input.alias) : "";
      if (!validKey(alias) || !validKey(station) || alias === station)
        return c.json({ error: "Alias o estación inválidos" }, 400);
      statement = db
        .prepare(
          `INSERT INTO station_aliases SELECT ?,slug FROM stations WHERE slug=?
        ON CONFLICT(alias) DO UPDATE SET station=excluded.station`,
        )
        .bind(alias, station);
      break;
    }
    case "fuel":
      if (!validKey(fuel) || !shortText(name, 100))
        return c.json({ error: "Combustible o nombre inválido" }, 400);
      statement = db
        .prepare("UPDATE fuel_types SET name=? WHERE id=?")
        .bind(name.trim(), fuel);
      break;
    case "source":
      if (
        (source !== "telegram" && source !== "official") ||
        typeof paused !== "boolean"
      )
        return c.json({ error: "Fuente o estado inválidos" }, 400);
      statement = db
        .prepare(
          "INSERT INTO application_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind("pause:" + source, String(paused));
      break;
    case "price":
      if (
        !validKey(station) ||
        !validKey(fuel) ||
        (source !== "telegram" && source !== "official") ||
        !shortText(event, 100) ||
        typeof price !== "number" ||
        !Number.isInteger(price) ||
        price < 300 ||
        price > 5000
      )
        return c.json({ error: "Observación o importe inválidos" }, 400);
      statement = db
        .prepare(
          `INSERT INTO price_corrections(station,fuel,source,event,price,reason)
        SELECT station,fuel,source,event,?,? FROM observations WHERE station=? AND fuel=? AND source=? AND event=?
        ON CONFLICT(station,fuel,source,event) DO UPDATE SET price=excluded.price,reason=excluded.reason,corrected_at=CURRENT_TIMESTAMP`,
        )
        .bind(price, input.reason.trim(), station, fuel, source, event);
      break;
    default:
      return c.json({ error: "Operación desconocida" }, 400);
  }
  const record = JSON.stringify({
    action,
    reason: input.reason.trim(),
    station,
    fuel,
    source,
    event,
    price,
    active,
    name,
    paused,
    alias: input.alias,
  });
  const [change] = await db.batch([
    statement,
    db
      .prepare("INSERT INTO audit_logs(action) SELECT ? WHERE changes()>0")
      .bind(record),
  ]);
  return change.meta.changes
    ? c.json({ data: { saved: true } })
    : c.json({ error: "Registro inexistente" }, 404);
});
