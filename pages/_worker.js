const workerOrigin = "https://costco-carburantes.rubenpalsis11.workers.dev";

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(workerOrigin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const upstream = await fetch(new Request(target, request), {
      redirect: "manual",
    });
    const headers = new Headers(upstream.headers);
    headers.set("X-CostGas-Gateway", "pages");
    const location = headers.get("location");
    if (location) {
      const redirect = new URL(location, target);
      if (redirect.origin === workerOrigin)
        headers.set(
          "location",
          incoming.origin + redirect.pathname + redirect.search + redirect.hash,
        );
    }
    if (incoming.hostname.endsWith(".pages.dev"))
      headers.set("X-Robots-Tag", "noindex");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
