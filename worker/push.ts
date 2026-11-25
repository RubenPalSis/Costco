import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Env } from './sync';

export function pushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && !u.hash &&
      (['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns2-par02p.notify.windows.com'].includes(u.hostname) || u.hostname.endsWith('.push.apple.com'));
  } catch { return false; }
}
export async function sendAlerts(env: Env) {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject) return;
  const rows = await env.DB.prepare(`SELECT a.id, p.event, p.station, p.fuel, p.price, p.previous, s.endpoint, s.p256dh, s.auth
    FROM price_alerts a JOIN current_prices p ON p.station=a.station AND p.fuel=a.fuel AND p.source='telegram'
    JOIN push_subscriptions s ON s.user_id=a.user_id
    WHERE datetime(p.published_at) > datetime('now','-30 minutes') AND datetime(p.published_at) >= datetime(a.created_at)
      AND NOT EXISTS (SELECT 1 FROM notification_logs n WHERE n.alert_id=a.id AND n.event=p.event)
      AND (a.kind='lower' AND p.price<p.previous OR a.kind='higher' AND p.price>p.previous
        OR a.kind='threshold' AND p.price<a.threshold AND (p.previous IS NULL OR p.previous>=a.threshold)
        OR a.kind='minimum' AND p.previous IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM observations o WHERE o.station=p.station AND o.fuel=p.fuel AND o.source=p.source AND o.published_at<p.published_at AND o.price<=p.price))
    LIMIT 8`).all<{id:string;event:string;station:string;fuel:string;price:number;previous:number|null;endpoint:string;p256dh:string;auth:string}>();
  for (const row of rows.results) {
    if (!pushEndpoint(row.endpoint)) continue;
    const claim = await env.DB.prepare('INSERT OR IGNORE INTO notification_logs(alert_id,event) VALUES (?,?)').bind(row.id,row.event).run();
    if (!claim.meta.changes) continue;
    try {
      const payload = await buildPushPayload({
        data: JSON.stringify({ title: 'Costco · ' + row.station, body: row.fuel + ' · ' + (row.previous === null ? '' : (row.previous/1000).toFixed(3)+' → ') + (row.price/1000).toFixed(3) + ' €/L', path: '/gasolineras/' + row.station }),
        options: { ttl: 3600 },
      }, { endpoint:row.endpoint, expirationTime:null, keys:{ p256dh:row.p256dh,auth:row.auth } }, { publicKey,privateKey,subject });
      const result = await fetch(row.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(5000)});
      if (result.status === 404 || result.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(row.endpoint).run();
      else if (!result.ok) throw new Error('Push HTTP '+result.status);
    } catch {
      await env.DB.prepare('DELETE FROM notification_logs WHERE alert_id=? AND event=?').bind(row.id,row.event).run();
    }
  }
}
