# Estado del proyecto

- [x] Consultar HTML real de Telegram, datos de MITECO y cuotas documentadas de Workers y D1.
- [x] Implementar aplicación React, Worker, API, esquema D1 y cron.
- [x] Separar modalidades; gestionar deduplicación, correcciones, antigüedad e importación paginada.
- [x] Crear mapa, histórico, exportación CSV, comparador, favoritos y calculadora.
- [x] Implementar suscripciones y alertas Web Push con VAPID.
- [x] Añadir temas, páginas legales, manifiesto instalable, fallback sin conexión, sitemap y robots.
- [x] Añadir herramientas, pruebas unitarias y flujos GitHub Actions.
- [ ] Validar acceso y autorización de reutilización para publicación pública.
- [ ] Configurar titular, contacto, cuenta, D1 remoto, URL pública y secretos.
- [ ] Validar Web Push real en navegador y PWA instalada en plataformas compatibles.
- [ ] Medir consumo de CPU real de los cron y de D1 en el plan gratuito.
- [x] Ampliar detección de estaciones y comparación a provincias limítrofes.
- [x] Publicar el contrato OpenAPI y renderizar en el Worker la portada y las fichas de estación.
- [x] Validar el parser y las escrituras D1 con respuestas descargadas de Telegram y MITECO.
- [x] Verificar favoritos, navegación, exportación disponible y calculadora en Chromium.
- [ ] Verificar conectividad del Worker desplegado con Telegram y MITECO. Las descargas de terminal funcionaron; la red saliente del emulador local devolvió error.
- [x] Ampliar la gestión administrativa a edición de estaciones, combustibles, fuentes, alias y correcciones auditadas.
- [x] Completar comparación histórica multiestación y medias ponderadas por duración.
- [x] Optimizar el histórico con una consulta acotada a la estación y al rango, y medir una ráfaga local con 5000 observaciones.
- [x] Verificar en Chromium la gráfica comparativa, la descarga CSV, el mapa y el modo sin conexión.
- [x] Verificar el alta, la baja, el cifrado y la deduplicación de Web Push con transporte simulado.
- [ ] Medir consumo bajo carga de producción y configurar Turnstile o Cloudflare Access según el dominio y la cuenta.
- [ ] Autorizar y verificar despliegue público, Search Console e importación histórica completa disponible.

## Versión centrada en Costco

- [x] Retirar la fuente anterior y el comparador con otras marcas de la web y la API.
- [x] Ocultar el enlace al canal en la web y la API pública.
- [x] El responsable del proyecto confirmó el permiso de reutilización del canal.
