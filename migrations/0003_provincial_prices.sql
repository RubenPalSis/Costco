ALTER TABLE nearby_prices ADD COLUMN province_id TEXT NOT NULL DEFAULT '';
CREATE INDEX nearby_province ON nearby_prices(province_id, station);
CREATE INDEX nearby_expiry ON nearby_prices(verified_at);
CREATE TABLE official_province_sync (province_id TEXT PRIMARY KEY, last_success TEXT NOT NULL);
