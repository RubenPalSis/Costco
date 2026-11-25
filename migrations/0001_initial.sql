CREATE TABLE stations (
  slug TEXT PRIMARY KEY, official_id TEXT UNIQUE, name TEXT NOT NULL, city TEXT NOT NULL,
  province TEXT NOT NULL, region TEXT, postal_code TEXT, address TEXT, latitude REAL, longitude REAL,
  hours TEXT, active INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE fuel_types (id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO fuel_types VALUES ('gas95','Gasolina 95 E5'),('gas98','Gasolina 98 E5'),('diesel','Diésel Plus'),('diesel-a','Gasóleo A');
CREATE TABLE data_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, modality TEXT NOT NULL);
INSERT INTO data_sources VALUES
 ('telegram','Canal público de Telegram','https://t.me/s/costco_gasolineras','socios'),
 ('official','MITECO','https://geoportalgasolineras.es/','declarada');
CREATE TABLE telegram_messages (id INTEGER PRIMARY KEY, published_at TEXT NOT NULL, fingerprint TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE observations (
 station TEXT NOT NULL REFERENCES stations(slug), fuel TEXT NOT NULL REFERENCES fuel_types(id),
 source TEXT NOT NULL REFERENCES data_sources(id), event TEXT NOT NULL, published_at TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price BETWEEN 300 AND 5000),
 PRIMARY KEY(station,fuel,source,event)
);
CREATE INDEX observations_time ON observations(station,fuel,source,published_at,event);
CREATE INDEX observations_event ON observations(source,event);
CREATE VIEW price_history AS
 SELECT * FROM (SELECT observations.*, LAG(price) OVER (PARTITION BY station,fuel,source ORDER BY published_at,event) AS previous
 FROM observations) WHERE previous IS NULL OR previous<>price;
CREATE VIEW current_prices AS
 SELECT *, price-previous AS variation FROM (
 SELECT price_history.*, ROW_NUMBER() OVER (PARTITION BY station,fuel,source ORDER BY published_at DESC,event DESC) AS ranking
 FROM price_history) WHERE ranking=1;
CREATE TABLE synchronization_logs (id INTEGER PRIMARY KEY, source TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sync_state (source TEXT PRIMARY KEY, last_success TEXT, next_attempt TEXT, cursor INTEGER, failures INTEGER NOT NULL DEFAULT 0);
CREATE TABLE users (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE favorites (user_id TEXT REFERENCES users(id) ON DELETE CASCADE, station TEXT REFERENCES stations(slug), PRIMARY KEY(user_id,station));
CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, p256dh TEXT NOT NULL, auth TEXT NOT NULL);
CREATE TABLE price_alerts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, station TEXT NOT NULL REFERENCES stations(slug), fuel TEXT NOT NULL REFERENCES fuel_types(id), kind TEXT NOT NULL CHECK(kind IN ('lower','higher','threshold','minimum')), threshold INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX alerts_prices ON price_alerts(station,fuel);
CREATE TABLE application_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, action TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE notification_logs (alert_id TEXT NOT NULL REFERENCES price_alerts(id) ON DELETE CASCADE, event TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(alert_id,event));
CREATE TABLE station_aliases (alias TEXT PRIMARY KEY, station TEXT NOT NULL REFERENCES stations(slug));
CREATE TABLE nearby_prices (
 station TEXT NOT NULL REFERENCES stations(slug), official_id TEXT NOT NULL, fuel TEXT NOT NULL REFERENCES fuel_types(id),
 name TEXT NOT NULL, address TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
 distance REAL NOT NULL, price INTEGER NOT NULL CHECK(price BETWEEN 300 AND 5000), verified_at TEXT NOT NULL,
 PRIMARY KEY(station,fuel,official_id)
);
CREATE INDEX nearby_distance ON nearby_prices(station,fuel,distance);
