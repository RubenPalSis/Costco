import { distance } from "./distance";
import {
  milli,
  officialUrl,
  parseTelegram,
  stationSlug,
  telegramUrl,
  type Message,
} from "./parser";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_ENABLED?: string;
  OFFICIAL_ENABLED?: string;
  DEGRADED_MODE?: string;
  ADMIN_TOKEN?: string;
  PUBLIC_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};
export async function sourceEnabled(env: Env, source: "telegram" | "official") {
  if (
    (source === "telegram" ? env.TELEGRAM_ENABLED : env.OFFICIAL_ENABLED) !==
    "true"
  )
    return false;
  return (
    (await env.DB.prepare("SELECT value FROM application_settings WHERE key=?")
      .bind("pause:" + source)
      .first<string>("value")) !== "true"
  );
}
export async function digest(value: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}

async function saveMessage(db: D1Database, message: Message) {
  const hash = await digest(JSON.stringify(message));
  if (
    (await db
      .prepare("SELECT fingerprint FROM telegram_messages WHERE id=?")
      .bind(message.id)
      .first<string>("fingerprint")) === hash
  )
    return false;
  const event = String(message.id).padStart(12, "0");
  const statements = [
    db
      .prepare("DELETE FROM observations WHERE source='telegram' AND event=?")
      .bind(event),
  ];
  const aliases = new Map(
    (
      await db
        .prepare("SELECT alias,station FROM station_aliases")
        .all<{ alias: string; station: string }>()
    ).results.map((row) => [row.alias, row.station]),
  );
  const stored = new Map(
    message.quotes.map((quote) => {
      const station = aliases.get(quote.station) ?? quote.station;
      return [station + ":" + quote.fuel, { ...quote, station }] as const;
    }),
  );
  for (const quote of stored.values()) {
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO stations(slug,name,city,province) VALUES (?,?,?,?)",
        )
        .bind(
          quote.station,
          "Costco " + quote.city,
          quote.city,
          quote.province,
        ),
    );
    statements.push(
      db
        .prepare("INSERT INTO observations VALUES (?,?,'telegram',?,?,?)")
        .bind(quote.station, quote.fuel, event, message.date, quote.price),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO telegram_messages (id,published_at,fingerprint) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,published_at=excluded.published_at,updated_at=CURRENT_TIMESTAMP",
      )
      .bind(message.id, message.date, hash),
  );
  await db.batch(statements);
  return true;
}

async function withLock<T>(
  db: D1Database,
  source: string,
  action: () => Promise<T>,
) {
  const owner = crypto.randomUUID(),
    now = Date.now();
  const claim = await db
    .prepare(
      `INSERT INTO sync_locks VALUES (?,?,?)
    ON CONFLICT(source) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE sync_locks.expires_at<?`,
    )
    .bind(source, owner, now + 180000, now)
    .run();
  if (!claim.meta.changes) return { skipped: true };
  try {
    return await action();
  } finally {
    await db
      .prepare("DELETE FROM sync_locks WHERE source=? AND owner=?")
      .bind(source, owner)
      .run();
  }
}
export function syncTelegram(
  env: Env,
  importHistory = false,
  fixture?: Response,
) {
  return withLock(env.DB, "telegram", () =>
    ingestTelegram(env, importHistory, fixture),
  );
}
async function ingestTelegram(
  env: Env,
  importHistory = false,
  fixture?: Response,
) {
  if (!fixture && !(await sourceEnabled(env, "telegram")))
    throw new Error("La fuente Telegram está desactivada");
  const source = importHistory ? "telegram-history" : "telegram";
  const state = await env.DB.prepare(
    "SELECT cursor,failures,next_attempt FROM sync_state WHERE source=?",
  )
    .bind(source)
    .first<{
      cursor: number | null;
      failures: number;
      next_attempt: string | null;
    }>();
  if (
    !fixture &&
    state?.next_attempt &&
    Date.parse(state.next_attempt) > Date.now()
  )
    return { skipped: true };
  if (importHistory && state?.cursor === 0) return { exhausted: true };
  let retry = 0;
  try {
    const url = new URL(telegramUrl);
    if (importHistory && state?.cursor)
      url.searchParams.set("before", String(state.cursor));
    const response =
      fixture ??
      (await fetch(url, {
        headers: { accept: "text/html" },
        signal: AbortSignal.timeout(12000),
      }));
    if (!response.ok) {
      const header = response.headers.get("Retry-After");
      retry = header
        ? Number(header) * 1000 || Date.parse(header) - Date.now()
        : 0;
      throw new Error("Telegram HTTP " + response.status);
    }
    const { messages, cursor } = await parseTelegram(response);
    if (!messages.length && (!importHistory || !state?.cursor))
      throw new Error(
        "Telegram no devolvió publicaciones de precios reconocibles",
      );
    const recent = importHistory ? messages : messages.slice(-4);
    let changed = 0;
    for (const message of recent.sort((a, b) => a.id - b.id))
      if (await saveMessage(env.DB, message)) changed++;
    const next = importHistory
      ? Number.isFinite(cursor) && cursor !== state?.cursor
        ? cursor
        : 0
      : null;
    await env.DB.prepare(
      "INSERT INTO sync_state VALUES (?,?,NULL,?,0) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success,next_attempt=NULL,cursor=excluded.cursor,failures=0",
    )
      .bind(source, new Date().toISOString(), next)
      .run();
    if (changed || importHistory)
      await log(env.DB, source, "Mensajes actualizados: " + changed);
    return { changed, cursor: next, scanned: recent.length };
  } catch (error) {
    const failures = (state?.failures ?? 0) + 1;
    const delay = Math.max(
      retry || 0,
      Math.min(86_400_000, 600_000 * 2 ** Math.min(failures, 8)),
    );
    await env.DB.prepare(
      "INSERT INTO sync_state VALUES (?,NULL,?,?,?) ON CONFLICT(source) DO UPDATE SET next_attempt=excluded.next_attempt,failures=excluded.failures",
    )
      .bind(
        source,
        new Date(Date.now() + delay).toISOString(),
        state?.cursor ?? null,
        failures,
      )
      .run();
    await log(
      env.DB,
      source,
      error instanceof Error ? error.message : "Error de sincronización",
    );
    throw error;
  }
}
export async function log(db: D1Database, source: string, result: string) {
  await db
    .prepare("INSERT INTO synchronization_logs(source,result) VALUES (?,?)")
    .bind(source, result.slice(0, 240))
    .run();
}

type Official = Record<string, string>;
const regions: Record<string, string> = {
  "01": "Andalucía",
  "02": "Aragón",
  "03": "Asturias",
  "04": "Illes Balears",
  "05": "Canarias",
  "06": "Cantabria",
  "07": "Castilla y León",
  "08": "Castilla-La Mancha",
  "09": "Cataluña",
  "10": "Comunitat Valenciana",
  "11": "Extremadura",
  "12": "Galicia",
  "13": "Comunidad de Madrid",
  "14": "Región de Murcia",
  "15": "Navarra",
  "16": "País Vasco",
  "17": "La Rioja",
  "18": "Ceuta",
  "19": "Melilla",
};
function officialTimestamp(value: string) {
  const match =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Fecha oficial no reconocida");
  const [, day, month, year, hour, minute, second] = match.map(Number);
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  const zone = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    timeZoneName: "longOffset",
  })
    .formatToParts(local)
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = zone?.match(/GMT\+(\d{2}):(\d{2})/);
  return new Date(
    local - (offset ? Number(offset[1]) * 60 + Number(offset[2]) : 0) * 60000,
  ).toISOString();
}
export const officialFields = {
  gas95: "Precio Gasolina 95 E5",
  gas98: "Precio Gasolina 98 E5",
  diesel: "Precio Gasoleo Premium",
  "diesel-a": "Precio Gasoleo A",
};
export function syncOfficial(env: Env, fixture?: Response) {
  return withLock(env.DB, "official", () => ingestOfficial(env, fixture));
}
async function ingestOfficial(env: Env, fixture?: Response) {
  if (!fixture && !(await sourceEnabled(env, "official")))
    throw new Error("La fuente oficial está desactivada");
  const state = await env.DB.prepare(
    "SELECT cursor FROM sync_state WHERE source='official'",
  ).first<number>("cursor");
  const priority = [48, 28, 29, 41, 50];
  const cycle = [
    ...priority,
    ...Array.from({ length: 52 }, (_, index) => index + 1).filter(
      (id) => !priority.includes(id),
    ),
  ];
  const province = String(
    cycle[(cycle.indexOf(state ?? 0) + 1) % cycle.length],
  ).padStart(2, "0");
  let body: { Fecha: string; ListaEESSPrecio: Official[] };
  let date: string;
  try {
    const response =
      fixture ??
      (await fetch(officialUrl + "FiltroProvincia/" + province, {
        signal: AbortSignal.timeout(12000),
      }));
    if (!response.ok) throw new Error("MITECO HTTP " + response.status);
    body = await response.json<typeof body>();
    if (!Array.isArray(body.ListaEESSPrecio))
      throw new Error("Formato inesperado de MITECO");
    date = officialTimestamp(body.Fecha);
  } catch (error) {
    if (!fixture) {
      await env.DB.prepare(
        "INSERT INTO sync_state(source,cursor,failures) VALUES ('official',?,1) ON CONFLICT(source) DO UPDATE SET cursor=excluded.cursor,failures=failures+1",
      )
        .bind(Number(province))
        .run();
      await log(
        env.DB,
        "official",
        "Provincia " +
          province +
          ": " +
          (error instanceof Error ? error.message : "Error de lectura"),
      );
    }
    throw error;
  }
  const coordinate = (value: string | undefined) =>
    value && Number.isFinite(Number(value.replace(",", ".")))
      ? Number(value.replace(",", "."))
      : null;
  const isCostco = (row: Official) => /\bCOSTCO\b/i.test(row["Rótulo"] ?? "");
  const officialStations = body.ListaEESSPrecio.filter(isCostco);
  const known = (
    await env.DB.prepare(
      "SELECT slug,official_id,latitude,longitude FROM stations ORDER BY slug",
    ).all<{
      slug: string;
      official_id: string | null;
      latitude: number | null;
      longitude: number | null;
    }>()
  ).results;
  const byOfficialId = new Map(
    known.filter((s) => s.official_id).map((s) => [s.official_id, s.slug]),
  );
  const occupied = new Map(known.map((s) => [s.slug, s.official_id]));
  const locations = new Map(
    known.flatMap((s) =>
      s.latitude !== null && s.longitude !== null
        ? [[s.slug, { lat: s.latitude, lon: s.longitude }] as const]
        : [],
    ),
  );
  let changed = 0;
  for (const row of officialStations) {
    const base = stationSlug(row.Municipio);
    const slug =
      byOfficialId.get(row.IDEESS) ??
      (occupied.get(base) && occupied.get(base) !== row.IDEESS
        ? base + "-" + row.IDEESS
        : base);
    occupied.set(slug, row.IDEESS);
    const statements = [
      env.DB.prepare(
        `INSERT INTO stations(slug,official_id,name,city,province,region,postal_code,address,latitude,longitude,hours)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET official_id=excluded.official_id,name=COALESCE(stations.name_override,excluded.name),city=excluded.city,province=excluded.province,region=excluded.region,postal_code=excluded.postal_code,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,hours=excluded.hours,updated_at=CURRENT_TIMESTAMP`,
      ).bind(
        slug,
        row.IDEESS,
        "Costco " + row.Municipio,
        row.Municipio,
        row.Provincia,
        regions[row.IDCCAA] ?? null,
        row["C.P."],
        row["Dirección"],
        coordinate(row.Latitud),
        coordinate(row["Longitud (WGS84)"]),
        row.Horario,
      ),
    ];
    for (const [fuel, key] of Object.entries(officialFields)) {
      const price = milli(row[key] ?? "");
      if (price)
        statements.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO observations VALUES (?,?,'official',?,?,?)",
          ).bind(slug, fuel, body.Fecha, date, price),
        );
    }
    const lat = coordinate(row.Latitud),
      lon = coordinate(row["Longitud (WGS84)"]);
    if (lat !== null && lon !== null) locations.set(slug, { lat, lon });
    await env.DB.batch(statements);
    changed++;
  }
  const candidates = body.ListaEESSPrecio.flatMap((other) => {
    if (isCostco(other)) return [];
    const latitude = coordinate(other.Latitud),
      longitude = coordinate(other["Longitud (WGS84)"]);
    return latitude === null || longitude === null
      ? []
      : [{ other, latitude, longitude }];
  });
  const partitions = fixture
    ? [...new Set(candidates.map((c) => c.other.IDProvincia))]
    : [province];
  for (const partition of partitions) {
    const regional = candidates.filter(
      (c) => c.other.IDProvincia === partition,
    );
    const previously = (
      await env.DB.prepare(
        "SELECT DISTINCT station FROM nearby_prices WHERE province_id=?",
      )
        .bind(partition)
        .all<{ station: string }>()
    ).results;
    const stale = new Set(previously.map((r) => r.station));
    for (const [slug, { lat, lon }] of locations) {
      const nearby = regional.flatMap((candidate) => {
        if (
          Math.abs(candidate.latitude - lat) > 0.46 ||
          Math.abs(candidate.longitude - lon) > 0.72
        )
          return [];
        const km = distance(lat, lon, candidate.latitude, candidate.longitude);
        return km <= 50 ? [{ ...candidate, km }] : [];
      });
      if (!nearby.length && !stale.has(slug)) continue;
      const statements = [
        env.DB.prepare(
          "DELETE FROM nearby_prices WHERE station=? AND province_id=?",
        ).bind(slug, partition),
      ];
      stale.delete(slug);
      for (const [fuel, field] of Object.entries(officialFields)) {
        const eligible = nearby.flatMap((candidate) => {
          const price = milli(candidate.other[field] ?? "");
          return price ? [{ ...candidate, price }] : [];
        });
        const selected = new Map<string, (typeof eligible)[number]>();
        for (const radius of [5, 10, 20, 50]) {
          const best = eligible
            .filter((c) => c.km <= radius)
            .sort((a, b) => a.price - b.price || a.km - b.km)
            .slice(0, 5);
          for (const candidate of best)
            selected.set(candidate.other.IDEESS, candidate);
        }
        for (const c of selected.values())
          statements.push(
            env.DB.prepare(
              "INSERT INTO nearby_prices VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(station,fuel,official_id) DO UPDATE SET name=excluded.name,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,distance=excluded.distance,price=excluded.price,verified_at=excluded.verified_at,province_id=excluded.province_id",
            ).bind(
              slug,
              c.other.IDEESS,
              fuel,
              c.other["Rótulo"],
              c.other["Dirección"],
              c.latitude,
              c.longitude,
              c.km,
              c.price,
              date,
              partition,
            ),
          );
      }
      await env.DB.batch(statements);
    }
    if (stale.size)
      await env.DB.batch(
        [...stale].map((slug) =>
          env.DB.prepare(
            "DELETE FROM nearby_prices WHERE station=? AND province_id=?",
          ).bind(slug, partition),
        ),
      );
    await env.DB.prepare(
      "INSERT INTO official_province_sync VALUES (?,?) ON CONFLICT(province_id) DO UPDATE SET last_success=excluded.last_success",
    )
      .bind(partition, date)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO sync_state(source,last_success,cursor) VALUES ('official',?,?) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success,cursor=excluded.cursor,failures=0",
  )
    .bind(new Date().toISOString(), fixture ? (state ?? 0) : Number(province))
    .run();
  if (changed)
    await log(env.DB, "official", "Estaciones consultadas: " + changed);
  return { changed, province: fixture ? null : province };
}
