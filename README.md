# AhorroCarburante

**Proyecto personal e independiente.** AhorroCarburante se creó por iniciativa propia de un usuario particular que no trabaja para Costco. El proyecto carece de afiliación, patrocinio y respaldo de Costco. El nombre Costco se usa para identificar las gasolineras incluidas en la consulta. La independencia del proyecto y los derechos de reutilización de las fuentes se revisan por separado.

Plataforma para consultar y comparar carburantes de Costco España. React, Vite, TypeScript, Hono, Workers Static Assets y D1. Leaflet carga el mapa y Recharts carga las gráficas bajo demanda. No requiere un servidor local tras el despliegue.

## Desarrollo

Requiere Node.js 24.

```sh
npm ci
npm run lint
npm test
npm run build
npm run db:local
npx playwright install chromium
npm run test:browser
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

La versión pública se centra en las estaciones Costco. La extracción automática autorizada consulta Telegram en el servidor. La web y la API pública muestran los precios sin enlazar al canal. El mapa solo muestra estaciones con coordenadas disponibles.

D1 contiene `stations`, `fuel_types`, `observations`, `telegram_messages`, `data_sources`, `synchronization_logs`, `sync_state`, `users`, `sessions`, `favorites`, `push_subscriptions`, `price_alerts`, `application_settings`, `audit_logs`, `notification_logs`, `station_aliases` y `nearby_prices`. Los precios vigentes y el histórico son vistas SQL. `sync_locks` previene la ejecución simultánea por origen. `official_province_sync` registra coberturas provinciales y `price_corrections` guarda correcciones sobre observaciones originales. Los favoritos se guardan en el dispositivo. La tarea diaria depura sesiones vencidas y registros operativos según sus plazos.

## Verificación y API

- `npm test` ejecuta lógica de dominio y pruebas del Worker con Miniflare y una D1 local.
- `COSTCO_TELEGRAM_HTML=RUTA_HTML npm test` añade la prueba con respuestas reales descargadas por quien ejecuta la prueba. Los archivos de las fuentes no se almacenan en GitHub.
- `npm run test:browser` verifica favoritos, fichas y cálculo en Chromium con respuestas controladas. El envío de Web Push real requiere credenciales y un navegador compatible; sigue pendiente.
- El contrato REST está en [public/openapi.yml](public/openapi.yml), servido en `/openapi.yml`. La portada y las fichas entregan HTML desde el Worker. Las fichas incluyen etiquetas sociales y un objeto `GasStation` al configurar `PUBLIC_URL`.
- El histórico compara dos estaciones de la misma fuente. La media se pondera desde el primer precio conocido dentro del rango o desde el precio que ya estaba vigente al inicio. El gráfico muestra hasta 366 cambios recientes por estación y la API permite paginar el resto.
- El panel administrativo permite editar nombre y visibilidad de estaciones, asignar alias de Telegram para futuras importaciones, cambiar nombres de combustibles, pausar fuentes autorizadas y corregir observaciones. Las correcciones se superponen al valor original y se auditan con motivo y fecha. El panel usa una credencial administrativa compartida y no identifica a operadores individuales.
- `COSTCO_BENCHMARK=1 npm test` mide 40 consultas de histórico en Miniflare, cuatro concurrentes, con 5000 observaciones sintéticas. La prueba comprueba el resultado y registra latencias locales. Las cifras no equivalen a CPU ni facturación de Cloudflare.
- En este entorno, las descargas por terminal funcionaron y los extractores procesaron los archivos reales. La conexión saliente del proceso Wrangler no permitió hacer la sincronización en vivo.

## Producción gratuita

2. Completa titular y contacto en `src/data.ts` y revisa los textos legales según la operación efectiva.
3. Selecciona un plan gratuito, entra con `npx wrangler login` y crea la base con `npx wrangler d1 create costco-carburantes`.
4. Ejecuta `node scripts/configure-d1.mjs UUID_REAL` y `npx wrangler d1 migrations apply DB --remote`.
5. Configura las fuentes autorizadas y `PUBLIC_URL` con el origen workers.dev en `wrangler.jsonc`. Guarda el token administrativo con `npx wrangler secret put ADMIN_TOKEN`.
6. Para Web Push, genera un par con `node scripts/vapid.mjs`. Guarda `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` y `VAPID_SUBJECT` con `npx wrangler secret put NOMBRE`. El asunto debe ser un contacto autorizado como `mailto:contacto@dominio.es`. No subas las claves privadas a Git.
7. Ejecuta `npm run deploy`. Los disparadores están en Wrangler. Ejecuta la primera sincronización y las importaciones históricas con las rutas administrativas anteriores, usando el dominio desplegado. Consulta registros con `npx wrangler tail`.
8. Comprueba el sitemap, robots, la actualización de precios, el mapa y una notificación real. En iOS y iPadOS, Web Push requiere iOS/iPadOS 16.4 o superior y añadir la web a la pantalla de inicio. En otros sistemas depende del navegador, HTTPS y el permiso de notificaciones.
9. Verifica el prefijo de URL en Google Search Console y envía `/sitemap.xml`. Para GitHub Actions, sigue la configuración del flujo de publicación al final de este README.

### Presupuesto


A 3 peticiones dinámicas por visita corta, el máximo teórico por peticiones sería de unas 33.000 visitas diarias. D1 puede limitar antes: con 1.000 filas leídas por visita serían unas 5.000 visitas/día, antes de reservar margen para comparador, sesiones largas y cron. Son estimaciones, no mediciones. Las vistas consultan observaciones históricas y su coste crece con la importación. Haz una prueba de carga y revisa filas leídas y CPU antes de abrir al público. Los runners estándar de GitHub Actions son gratuitos para repositorios públicos. Las fuentes deshabilitadas no generan consultas externas. Si el consumo se acerca a los límites, configura `DEGRADED_MODE=true` para aumentar la duración de la caché de API, reducir la fuente a una consulta por hora y suspender importaciones. Turnstile y Access requieren configuración de cuenta. Turnstile sería útil para el alta pública de Web Push y Access para proteger rutas administrativas si el dominio y el despliegue lo permiten.

- [Límites de Workers](https://developers.cloudflare.com/workers/platform/limits/)
- [Precios y cuotas de D1](https://developers.cloudflare.com/d1/platform/pricing/)
- [Facturación de GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

Consulta [TASKS.md](TASKS.md) para los requisitos de producción y las comprobaciones pendientes.


El flujo de GitHub Actions usa los secretos de Cloudflare del entorno `production` y se puede ejecutar mediante una etiqueta de publicación `publicar-v*`.
