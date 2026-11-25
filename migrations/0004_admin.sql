ALTER TABLE stations ADD COLUMN name_override TEXT;
CREATE TABLE price_corrections (
 station TEXT NOT NULL, fuel TEXT NOT NULL, source TEXT NOT NULL, event TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price BETWEEN 300 AND 5000), reason TEXT NOT NULL,
 corrected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(station,fuel,source,event)
);
CREATE VIEW effective_observations AS
 SELECT o.station,o.fuel,o.source,o.event,o.published_at,COALESCE(c.price,o.price) AS price
 FROM observations o LEFT JOIN price_corrections c USING(station,fuel,source,event);
DROP VIEW current_prices;
DROP VIEW price_history;
CREATE VIEW price_history AS
 SELECT * FROM (SELECT effective_observations.*, LAG(price) OVER (PARTITION BY station,fuel,source ORDER BY published_at,event) AS previous
 FROM effective_observations) WHERE previous IS NULL OR previous<>price;
CREATE VIEW current_prices AS
 SELECT *,price-previous AS variation FROM (
 SELECT price_history.*,ROW_NUMBER() OVER (PARTITION BY station,fuel,source ORDER BY published_at DESC,event DESC) AS ranking
 FROM price_history) WHERE ranking=1;
