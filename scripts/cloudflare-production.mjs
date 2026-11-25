import { appendFile } from "node:fs/promises";

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, GITHUB_OUTPUT } = process.env;
if (!account || !token) throw new Error("Falta CLOUDFLARE_ACCOUNT_ID o CLOUDFLARE_API_TOKEN en production.");
if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("CLOUDFLARE_ACCOUNT_ID debe contener 32 caracteres hexadecimales.");
if (!GITHUB_OUTPUT) throw new Error("Ejecuta este script desde GitHub Actions.");

async function cloudflare(path, options) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    const codes = result?.errors?.map(error => String(error.code)).join(", ") || "sin código";
    throw new Error(`Cloudflare ${path.split("?")[0]}: HTTP ${response.status} (errores: ${codes})`);
  }
  return result.result;
}

const domain = await cloudflare("workers/subdomain");
if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain?.subdomain ?? ""))
  throw new Error("Activa el subdominio gratuito workers.dev en la sección Workers & Pages de Cloudflare.");

const name = "costco-carburantes";
const databases = await cloudflare("d1/database?name=" + name);
const database = databases.find(item => item.name === name) ??
  await cloudflare("d1/database", { method: "POST", body: JSON.stringify({ name }) });
if (!/^[a-f0-9-]{36}$/i.test(database?.uuid ?? "")) throw new Error("Cloudflare no devolvió un ID D1 válido.");
await appendFile(GITHUB_OUTPUT,
  `database_id=${database.uuid}\nurl=https://${name}.${domain.subdomain}.workers.dev\n`);
