import { distance } from './distance';
import { milli, officialUrl, parseTelegram, stationSlug, telegramUrl, type Message } from './parser';

export type Env = { DB: D1Database; ASSETS: Fetcher; TELEGRAM_ENABLED?: string; OFFICIAL_ENABLED?: string; ADMIN_TOKEN?: string; PUBLIC_URL?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
export const apiCacheVersion = 'v1';
export async function digest(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}

async function saveMessage(db: D1Database, message: Message) {
  const hash = await digest(JSON.stringify(message));
  if ((await db.prepare('SELECT fingerprint FROM telegram_messages WHERE id=?').bind(message.id).first<string>('fingerprint')) === hash) return false;
  const event = String(message.id).padStart(12, '0');
  const statements = [db.prepare("DELETE FROM observations WHERE source='telegram' AND event=?").bind(event)];
  for (const quote of message.quotes) {
    statements.push(db.prepare("INSERT OR IGNORE INTO stations(slug,name,city,province) VALUES (?,?,?,?)").bind(quote.station, 'Costco ' + quote.city, quote.city, quote.province));
    statements.push(db.prepare("INSERT INTO observations VALUES (?,?,'telegram',?,?,?)").bind(quote.station, quote.fuel, event, message.date, quote.price));
  }
  statements.push(db.prepare('INSERT INTO telegram_messages (id,published_at,fingerprint) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,published_at=excluded.published_at,updated_at=CURRENT_TIMESTAMP').bind(message.id, message.date, hash));
  await db.batch(statements);
  return true;
}

export async function syncTelegram(env: Env, importHistory = false, fixture?: Response) {
  if (env.TELEGRAM_ENABLED !== 'true' && !fixture) throw new Error('La fuente Telegram está desactivada');
  const source = importHistory ? 'telegram-history' : 'telegram';
  const state = await env.DB.prepare('SELECT cursor,failures,next_attempt FROM sync_state WHERE source=?').bind(source).first<{cursor: number | null; failures: number; next_attempt: string | null}>();
  if (!fixture && state?.next_attempt && Date.parse(state.next_attempt) > Date.now()) return { skipped: true };
  if (importHistory && state?.cursor === 0) return { exhausted: true };
  let retry = 0;
  try {
    const url = new URL(telegramUrl);
    if (importHistory && state?.cursor) url.searchParams.set('before', String(state.cursor));
    const response = fixture ?? await fetch(url, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      const header = response.headers.get('Retry-After');
      retry = header ? (Number(header) * 1000 || Date.parse(header) - Date.now()) : 0;
      throw new Error('Telegram HTTP ' + response.status);
    }
    const { messages, cursor } = await parseTelegram(response);
    if (!messages.length && (!importHistory || !state?.cursor)) throw new Error('Telegram no devolvió publicaciones de precios reconocibles');
    const recent = importHistory ? messages : messages.slice(-4);
    let changed = 0;
    for (const message of recent.sort((a,b) => a.id - b.id)) if (await saveMessage(env.DB, message)) changed++;
    const next = importHistory ? (Number.isFinite(cursor) && cursor !== state?.cursor ? cursor : 0) : null;
    await env.DB.prepare('INSERT INTO sync_state VALUES (?,?,NULL,?,0) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success,next_attempt=NULL,cursor=excluded.cursor,failures=0').bind(source,new Date().toISOString(),next).run();
    if (changed || importHistory) await log(env.DB,source,'Mensajes actualizados: ' + changed);
    return { changed, cursor: next, scanned: recent.length };
  } catch (error) {
    const failures = (state?.failures ?? 0) + 1;
    const delay = Math.max(retry || 0, Math.min(86_400_000, 600_000 * 2 ** Math.min(failures, 8)));
    await env.DB.prepare('INSERT INTO sync_state VALUES (?,NULL,?,?,?) ON CONFLICT(source) DO UPDATE SET next_attempt=excluded.next_attempt,failures=excluded.failures').bind(source,new Date(Date.now()+delay).toISOString(),state?.cursor ?? null,failures).run();
    await log(env.DB, source, error instanceof Error ? error.message : 'Error de sincronización');
    throw error;
  }
}
export async function log(db: D1Database, source: string, result: string) {
  await db.prepare('INSERT INTO synchronization_logs(source,result) VALUES (?,?)').bind(source,result.slice(0,240)).run();
}

type Official = Record<string,string>;
export const officialFields = { gas95: 'Precio Gasolina 95 E5', gas98: 'Precio Gasolina 98 E5', diesel: 'Precio Gasoleo Premium', 'diesel-a': 'Precio Gasoleo A' };
export async function syncOfficial(env: Env, fixture?: Response) {
  if (env.OFFICIAL_ENABLED !== 'true' && !fixture) throw new Error('La fuente oficial está desactivada');
  const response = fixture ?? await fetch(officialUrl + 'FiltroProvincia/50', { signal: AbortSignal.timeout(12000) });
  const urls = ['48','28','29','41'].map(id => officialUrl + 'FiltroProvincia/' + id);
  const responses = fixture ? [response] : [response, ...await Promise.all(urls.map(url => fetch(url, { signal: AbortSignal.timeout(12000) })))];
  let changed = 0;
  for (const item of responses) {
    if (!item.ok) throw new Error('MITECO HTTP ' + item.status);
    const body = await item.json<{ Fecha: string; ListaEESSPrecio: Official[] }>();
    if (!Array.isArray(body.ListaEESSPrecio)) throw new Error('Formato inesperado de MITECO');
    const date = new Date().toISOString();
    for (const row of body.ListaEESSPrecio.filter(row => /\bCOSTCO\b/i.test(row['Rótulo'] ?? ''))) {
      const slug = stationSlug(row.Municipio);
      const coordinate = (value: string) => value && Number.isFinite(Number(value.replace(',', '.'))) ? Number(value.replace(',', '.')) : null;
      const statements = [env.DB.prepare(`INSERT INTO stations(slug,official_id,name,city,province,region,postal_code,address,latitude,longitude,hours)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET official_id=excluded.official_id,name=excluded.name,city=excluded.city,province=excluded.province,region=excluded.region,postal_code=excluded.postal_code,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,hours=excluded.hours,updated_at=CURRENT_TIMESTAMP`)
        .bind(slug,row.IDEESS,'Costco '+row.Municipio,row.Municipio,row.Provincia,row['Comunidad Autónoma'] ?? null,row['C.P.'],row['Dirección'],coordinate(row.Latitud),coordinate(row['Longitud (WGS84)']),row.Horario)];
      for (const [fuel,key] of Object.entries(officialFields)) {
        const price = milli(row[key] ?? '');
        if (price) statements.push(env.DB.prepare("INSERT OR IGNORE INTO observations VALUES (?,?,'official',?,?,?)").bind(slug,fuel,body.Fecha,date,price));
      }
      const lat = coordinate(row.Latitud), lon = coordinate(row['Longitud (WGS84)']);
      if (lat !== null && lon !== null) {
        statements.push(env.DB.prepare('DELETE FROM nearby_prices WHERE station=?').bind(slug));
        const nearby = body.ListaEESSPrecio.flatMap(other => {
          if (/\bCOSTCO\b/i.test(other['Rótulo'] ?? '')) return [];
          const latitude = coordinate(other.Latitud), longitude = coordinate(other['Longitud (WGS84)']);
          if (latitude === null || longitude === null) return [];
          const km = distance(lat,lon,latitude,longitude);
          return km <= 50 ? [{other,latitude,longitude,km}] : [];
        }).sort((a,b) => a.km-b.km);
        for (const [fuel,field] of Object.entries(officialFields)) {
          const eligible = nearby.flatMap(candidate => {
            const price = milli(candidate.other[field] ?? '');
            return price ? [{...candidate,price}] : [];
          });
          const selected = new Map<string,(typeof eligible)[number]>();
          for (const radius of [5,10,20,50]) {
            const best = eligible.filter(c => c.km<=radius).sort((a,b) => a.price-b.price || a.km-b.km).slice(0,5);
            for (const candidate of best) selected.set(candidate.other.IDEESS,candidate);
          }
          for (const c of selected.values()) statements.push(env.DB.prepare('INSERT INTO nearby_prices VALUES (?,?,?,?,?,?,?,?,?,?)')
            .bind(slug,c.other.IDEESS,fuel,c.other['Rótulo'],c.other['Dirección'],c.latitude,c.longitude,c.km,c.price,date));
        }
      }
      await env.DB.batch(statements);
      changed++;
    }
  }
  if (!changed) throw new Error('MITECO no devolvió estaciones Costco');
  await env.DB.prepare("INSERT INTO sync_state(source,last_success) VALUES ('official',?) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success").bind(new Date().toISOString()).run();
  await log(env.DB,'official','Estaciones consultadas: '+changed);
  return { changed };
}
