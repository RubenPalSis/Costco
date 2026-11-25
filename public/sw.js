const cacheName = "ahorro-shell-v2";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(["/offline.html", "/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("ahorro-shell-") && key !== cacheName,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    event.request.method !== "GET" ||
    event.request.headers.has("authorization")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html")),
    );
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(cacheName).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      }),
    );
  }
});
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const alert = event.data.json();
  event.waitUntil(
    self.registration.showNotification(alert.title, {
      body: alert.body,
      icon: "/icon-192.png",
      data: alert.path,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    typeof event.notification.data === "string" ? event.notification.data : "/",
    self.location.origin,
  );
  if (target.origin === self.location.origin)
    event.waitUntil(self.clients.openWindow(target.href));
});
