const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } =
  process.env;
if (!account || !token)
  throw new Error("Faltan las credenciales de Cloudflare.");
const name = "costgas-zetaweb";
const hostname = "costgas.zetaweb.es";

async function cloudflare(path, body, allowMissing = false) {
  const method = body ? "POST" : "GET";
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    },
  );
  if (allowMissing && response.status === 404) return null;
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const codes = payload.errors?.map((item) => item.code).join(", ");
    throw new Error(
      `Cloudflare Pages ${method}: HTTP ${response.status} (errores: ${codes ?? "sin código"}). El token necesita Cloudflare Pages: Edit.`,
    );
  }
  return payload.result;
}

if (process.argv[2] === "create") {
  const project = await cloudflare("/" + name, undefined, true);
  if (
    project &&
    (project.source || project.production_branch !== "costgas-production")
  )
    throw new Error(
      "El nombre de Pages ya pertenece a otro proyecto. No se modificó.",
    );
  if (!project)
    await cloudflare("", { name, production_branch: "costgas-production" });
} else if (process.argv[2] === "attach") {
  const domain =
    (await cloudflare(`/${name}/domains/${hostname}`, undefined, true)) ??
    (await cloudflare(`/${name}/domains`, { name: hostname }));
  console.log(`${domain.name}: ${domain.status}`);
  console.log(`CNAME ${hostname} → ${name}.pages.dev`);
} else {
  throw new Error("Indica create o attach.");
}
