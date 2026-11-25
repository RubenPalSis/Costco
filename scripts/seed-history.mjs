import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const output = process.argv[2];
const {
  CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_API_TOKEN: token,
  DATABASE_ID: database,
} = process.env;
if (!output || !account || !token || !database)
  throw new Error("Falta configurar la importación D1.");

async function query(sql) {
  const result = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!result.ok)
    throw new Error(`Consulta D1 fallida (HTTP ${result.status})`);
  const payload = await result.json();
  if (!payload.success || !payload.result?.[0]?.success)
    throw new Error("Consulta D1 fallida");
  return payload.result[0].results;
}

const state = await query(
  "SELECT source FROM sync_state WHERE source='telegram-history' AND last_success IS NOT NULL",
);
if (state.length) {
  console.log("El histórico inicial ya se ha cargado.");
  process.exit(0);
}
const [source] = await query(
  "SELECT url FROM data_sources WHERE id='telegram'",
);
const url = new URL(source?.url ?? "https://invalid.invalid");
const channel = /^\/s\/([a-z0-9_]+)\/?$/i.exec(url.pathname)?.[1];
if (
  url.origin !== "https://t.me" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  !channel
)
  throw new Error("Fuente Telegram sin configurar");

const { outputFiles } = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
    import {parseTelegram} from "./worker/parser";
    export default {async fetch(req) {
      return Response.json(await parseTelegram(new Response(req.body),req.headers.get("x-channel")));
    }};
  `,
  },
  bundle: true,
  write: false,
  format: "esm",
});
const parser = new Miniflare({
  modules: true,
  script: outputFiles[0].text,
  compatibilityDate: "2026-07-30",
});
const messages = new Map();
let cursor;
try {
  for (let page = 0; page < 8; page++) {
    if (cursor) url.searchParams.set("before", String(cursor));
    const response = await fetch(url, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok)
      throw new Error(
        `Telegram no completó la descarga (HTTP ${response.status})`,
      );
    const parsed = await parser.dispatchFetch("http://localhost/", {
      method: "POST",
      headers: { "x-channel": channel },
      body: await response.text(),
    });
    if (!parsed.ok) throw new Error("No se pudo interpretar la publicación");
    const data = await parsed.json();
    for (const message of data.messages) messages.set(message.id, message);
    if (!data.cursor || data.cursor === cursor) {
      cursor = 0;
      break;
    }
    cursor = data.cursor;
    if (page < 7) await new Promise((resolve) => setTimeout(resolve, 1250));
  }
} finally {
  await parser.dispose();
}
if (!messages.size)
  throw new Error("No se encontraron precios históricos válidos");

const sqlValue = (value) =>
  typeof value === "number"
    ? String(value)
    : "'" + value.replaceAll("'", "''") + "'";
const statements = [];
for (const message of [...messages.values()].sort((a, b) => a.id - b.id)) {
  const event = String(message.id).padStart(12, "0");
  const hash = createHash("sha256")
    .update(JSON.stringify(message))
    .digest("hex");
  const newMessage = `NOT EXISTS(SELECT 1 FROM telegram_messages WHERE id=${message.id})`;
  for (const quote of message.quotes) {
    const fields = [
      quote.station,
      "Costco " + quote.city,
      quote.city,
      quote.province,
    ]
      .map(sqlValue)
      .join(",");
    statements.push(`INSERT INTO stations(slug,name,city,province) SELECT ${fields} WHERE ${newMessage}
      ON CONFLICT(slug) DO UPDATE SET official_id=NULL,name=COALESCE(stations.name_override,excluded.name),city=excluded.city,
      province=excluded.province,region=NULL,postal_code=NULL,address=NULL,latitude=NULL,longitude=NULL,hours=NULL
      WHERE stations.official_id IS NOT NULL;`);
    const values = [
      quote.station,
      quote.fuel,
      "telegram",
      event,
      message.date,
      quote.price,
    ]
      .map(sqlValue)
      .join(",");
    statements.push(
      `INSERT OR IGNORE INTO observations SELECT ${values} WHERE ${newMessage};`,
    );
  }
  statements.push(`INSERT OR IGNORE INTO telegram_messages(id,published_at,fingerprint)
    VALUES (${message.id},${sqlValue(message.date)},${sqlValue(hash)});`);
}
statements.push(`INSERT OR IGNORE INTO sync_state(source,last_success,cursor,failures)
  VALUES ('telegram-history', ${sqlValue(new Date().toISOString())}, ${cursor ?? 0}, 0);`);
await writeFile(output, statements.join("\n"), { mode: 0o600 });
console.log(
  `Importación preparada: ${messages.size} publicaciones con precios.`,
);
