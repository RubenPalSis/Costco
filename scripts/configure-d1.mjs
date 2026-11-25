import { readFile, writeFile } from "node:fs/promises";

const id = process.argv[2];
if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id ?? "")) {
  throw new Error("Indica el UUID real de la base D1 como argumento.");
}
const file = new URL("../wrangler.jsonc", import.meta.url);
const config = await readFile(file, "utf8");
await writeFile(file, config.replace(/("database_id":\s*")[^"]+/, "$1" + id));
