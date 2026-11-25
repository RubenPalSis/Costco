import { parseTelegram, telegramUrl, type Message } from "./parser";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_ENABLED?: string;
  DEGRADED_MODE?: string;
  ADMIN_TOKEN?: string;
  PUBLIC_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};
export async function sourceEnabled(env: Env, source: "telegram") {
  if (env.TELEGRAM_ENABLED !== "true") return false;
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
          `INSERT INTO stations(slug,name,city,province) VALUES (?,?,?,?)
           ON CONFLICT(slug) DO UPDATE SET official_id=NULL,name=COALESCE(stations.name_override,excluded.name),city=excluded.city,province=excluded.province,
             region=NULL,postal_code=NULL,address=NULL,latitude=NULL,longitude=NULL,hours=NULL WHERE stations.official_id IS NOT NULL`,
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
