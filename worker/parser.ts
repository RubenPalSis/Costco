export const telegramUrl = 'https://t.me/s/costco_gasolineras';
export const officialUrl = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
export const slugify = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fuels: Record<string,string> = { 'diesel-plus': 'diesel', 'gas95-e5-plus': 'gas95', 'gas98-e5-plus': 'gas98' };
const aliases: Record<string,string> = { 'rozas-de-madrid-las': 'las-rozas', 'las-rozas-de-madrid': 'las-rozas' };
export const stationSlug = (value: string) => aliases[slugify(value)] ?? slugify(value);
export function milli(value: string) {
  const match = /^(\d{1,2})[,.](\d{1,3})$/.exec(value.trim());
  const price = match ? Number(match[1]) * 1000 + Number(match[2].padEnd(3, '0')) : 0;
  return price >= 300 && price <= 5000 ? price : null;
}
export type Quote = { station: string; city: string; province: string; fuel: string; price: number };
export type Message = { id: number; date: string; quotes: Quote[] };
export function parseMessage(id: number, date: string, body: string): Message | null {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(Date.parse(date)) || !/PRECIOS COMBUSTIBLE SOCIOS/i.test(body)) return null;
  let city = '', province = '';
  const quotes = new Map<string, Quote>();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { city = ''; province = ''; continue; }
    const priceLine = /^⛽\s*(.+?)\s*·\s*(\d{1,2}[,.]\d{1,3})\s*€(?:\s*[⬇⬆↓↑️]+)?\s*$/u.exec(line);
    if (priceLine && city) {
      const fuel = fuels[slugify(priceLine[1])];
      const price = milli(priceLine[2]);
      const station = stationSlug(city);
      if (fuel && price && station) quotes.set(station + ':' + fuel, { station, city, province, fuel, price });
      continue;
    }
    if (line.startsWith('⛽')) continue;
    const heading = /^([\p{L} ()'-]+)\s*·\s*([\p{L} /'-]+)$/u.exec(line);
    city = heading?.[1].trim() ?? '';
    province = heading?.[2].trim() ?? '';
  }
  return quotes.size ? { id, date: new Date(date).toISOString(), quotes: [...quotes.values()] } : null;
}
export async function parseTelegram(response: Response) {
  const cards: { id: number; date: string; body: string }[] = [];
  const rewriter = new HTMLRewriter()
    .on('.tgme_widget_message[data-post]', { element(element) {
      const id = /^costco_gasolineras\/(\d+)$/.exec(element.getAttribute('data-post') ?? '');
      cards.push({ id: Number(id?.[1]), date: '', body: '' });
    } })
    .on('.tgme_widget_message_date time', { element(element) {
      if (cards.length) cards[cards.length - 1].date = element.getAttribute('datetime') ?? '';
    } })
    .on('.tgme_widget_message_text', { text(chunk) {
      if (cards.length) cards[cards.length - 1].body += chunk.text;
    } })
    .on('.tgme_widget_message_text br', { element() {
      if (cards.length) cards[cards.length - 1].body += '\n';
    } });
  await rewriter.transform(response).arrayBuffer();
  return { messages: cards.map(c => parseMessage(c.id, c.date, c.body)).filter((m): m is Message => m !== null), cursor: Math.min(...cards.map(c => c.id).filter(Number.isSafeInteger)) };
}
