# AhorroCarburante

Plataforma independiente para consultar y comparar carburantes de Costco España. React, Vite, TypeScript, Hono, Workers Static Assets y D1. Leaflet carga el mapa y Recharts carga las gráficas bajo demanda. No requiere un servidor local tras el despliegue.

## Desarrollo

Requiere Node.js 24.

```sh
npm ci
npm run lint
npm test
npm run build
npm run db:local
cp .dev.vars.example .dev.vars
npm run preview
```

La aplicación está en `http://127.0.0.1:8787`. Para recargar la interfaz al editar, abre otra terminal con `npm run dev`. Ambas fuentes están deshabilitadas por defecto. Para pruebas locales autorizadas, configura en `.dev.vars` un `ADMIN_TOKEN` aleatorio de al menos 32 caracteres alfanuméricos y habilita las fuentes deseadas.

```sh
curl -fsS -X POST -H "Authorization: Bearer $COSTCO_ADMIN_TOKEN" http://localhost:8787/api/v1/admin/sync
curl -fsS -X POST -H "Authorization: Bearer $COSTCO_ADMIN_TOKEN" 'http://localhost:8787/api/v1/admin/sync?source=official'
curl -fsS -X POST -H "Authorization: Bearer $COSTCO_ADMIN_TOKEN" http://localhost:8787/api/v1/admin/import
```

La importación procesa una página por llamada y guarda el cursor. Repite con pausas respetando los límites de Telegram. `cursor: 0` significa que ya no se detectó otra página. La API rechaza las operaciones sin credenciales y el panel `/admin` nunca guarda el token.

## Datos y capacidades

Telegram publica precios de socios con bloques de municipio y provincia, líneas de combustibles con «·», milésimas y, opcionalmente, flechas. El Worker usa `data-post`, `time[datetime]` y el texto de cada publicación. Guarda observaciones normalizadas, su propia fecha UTC y huellas para detectar ediciones. Los datos se muestran en hora de Madrid. El histórico deriva los cambios mediante SQL y reconstruye la secuencia al importar datos antiguos. El cron inspecciona los cuatro mensajes más recientes cada diez minutos. Las correcciones más antiguas dependen de reimportación; una publicación editada sin ninguna línea reconocible conserva el último dato válido.

El listado nacional de MITECO devolvió seis estaciones Costco en la consulta del 25 de noviembre de 2026. Los precios de gasolina 95 diferían de los publicados por Telegram el día anterior; las distintas horas impiden atribuir toda la diferencia a la modalidad. La interfaz almacena y presenta los precios por fuente. El cron oficial consulta Bizkaia, Madrid, Málaga, Sevilla y Zaragoza. El comparador indexa hasta cinco precios por combustible y radio en la provincia de la estación seleccionada, con distancias en línea recta. La detección oficial fuera de esas provincias y la cobertura interprovincial quedan pendientes. El mapa usa teselas estándar de OpenStreetMap con atribución; se requiere revisar su política de uso según el volumen de tráfico.

D1 contiene `stations`, `fuel_types`, `observations`, `telegram_messages`, `data_sources`, `synchronization_logs`, `sync_state`, `users`, `sessions`, `favorites`, `push_subscriptions`, `price_alerts`, `application_settings`, `audit_logs`, `notification_logs`, `station_aliases` y `nearby_prices`. Los precios vigentes y el histórico son vistas SQL. Los favoritos se guardan en el dispositivo. La tarea diaria depura sesiones vencidas y registros operativos según sus plazos.

## Producción gratuita

1. Obtén confirmación para la publicación. Revisa las condiciones de reutilización del [Portal de MITECO](https://geoportalgasolineras.es/), las [condiciones de Telegram](https://telegram.org/tos) y las del [servidor de teselas](https://operations.osmfoundation.org/policies/tiles/). La consulta pública de Telegram no confirma el permiso de republicación. Mantén esa fuente deshabilitada hasta aclararlo.
2. Completa titular y contacto en `src/data.ts` y revisa los textos legales según la operación efectiva.
3. Selecciona un plan gratuito, entra con `npx wrangler login` y crea la base con `npx wrangler d1 create costco-carburantes`.
4. Ejecuta `node scripts/configure-d1.mjs UUID_REAL` y `npx wrangler d1 migrations apply DB --remote`.
5. Configura las fuentes autorizadas y `PUBLIC_URL` con el origen workers.dev en `wrangler.jsonc`. Guarda el token administrativo con `npx wrangler secret put ADMIN_TOKEN`.
6. Para Web Push, genera un par con `node scripts/vapid.mjs`. Guarda `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` y `VAPID_SUBJECT` con `npx wrangler secret put NOMBRE`. El asunto debe ser un contacto autorizado como `mailto:contacto@dominio.es`. No subas las claves privadas a Git.
7. Ejecuta `npm run deploy`. Los disparadores están en Wrangler. Ejecuta la primera sincronización y las importaciones históricas con las rutas administrativas anteriores, usando el dominio desplegado. Consulta registros con `npx wrangler tail`.
8. Comprueba el sitemap, robots, la actualización de precios, el mapa y una notificación real. En iOS y iPadOS, Web Push requiere iOS/iPadOS 16.4 o superior y añadir la web a la pantalla de inicio. En otros sistemas depende del navegador, HTTPS y el permiso de notificaciones.
9. Verifica el prefijo de URL en Google Search Console y envía `/sitemap.xml`. Para GitHub Actions, configura el ID y token de Cloudflare como secretos, `D1_DATABASE_ID` como variable, y habilita `ALLOW_CLOUDFLARE_DEPLOY=true` solo tras autorizar el despliegue. Ejecuta manualmente el workflow desde `main`.

### Presupuesto

Objetivo de 0 €/mes en Cloudflare Free. Workers Free admite 100.000 peticiones diarias y 10 ms de CPU por petición o cron. D1 Free incluye 5 millones de filas leídas por día, 100.000 escritas por día y 5 GB totales. Los cron configurados producen 144 consultas programadas de Telegram y una sincronización provincial diaria de MITECO si se habilitan. Los assets atendidos directamente no consumen invocaciones de Worker. El intervalo de actualización con pestaña activa es de tres minutos; la API incluye ETag y caché privada para operaciones sensibles mediante `no-store`.

A 3 peticiones dinámicas por visita corta, el máximo teórico por peticiones sería de unas 33.000 visitas diarias. D1 puede limitar antes: con 1.000 filas leídas por visita serían unas 5.000 visitas/día, antes de reservar margen para comparador, sesiones largas y cron. Son estimaciones, no mediciones. Las vistas consultan observaciones históricas y su coste crece con la importación. Haz una prueba de carga y revisa filas leídas y CPU antes de abrir al público. Los runners estándar de GitHub Actions son gratuitos para repositorios públicos. Las fuentes deshabilitadas no generan consultas externas.

- [Límites de Workers](https://developers.cloudflare.com/workers/platform/limits/)
- [Precios y cuotas de D1](https://developers.cloudflare.com/d1/platform/pricing/)
- [Facturación de GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

Consulta [TASKS.md](TASKS.md) para los requisitos de producción y las comprobaciones pendientes.
