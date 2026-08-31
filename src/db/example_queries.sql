-- Example read-only queries used by the agent's tools.
--
-- These are the *shapes* the tools run. Every one is parametrized ($1, $2, ...) — model
-- output is bound as parameters, never concatenated. None of these expose the scoring
-- or valuation logic; they are plain aggregation over the schema in schema.sql.

-- search_listings: filtered listing, newest first.
SELECT id, detected_model, platform, price, status
FROM listings
WHERE detected_model ILIKE '%' || $1 || '%'
  AND ($2::text    IS NULL OR vertical = $2)
  AND ($3::numeric IS NULL OR price <= $3)
ORDER BY seen_at DESC
LIMIT $4;

-- count: how many matching listings/sales in a window.
SELECT count(*) AS n
FROM listings
WHERE detected_model ILIKE '%' || $1 || '%'
  AND ($2::text IS NULL OR vertical = $2)
  AND ($3::text IS NULL OR status   = $3)
  AND ($4::int  IS NULL OR seen_at >= now() - ($4 || ' days')::interval);

-- median_price: price distribution for a model, overall.
SELECT
    percentile_cont(0.5)  WITHIN GROUP (ORDER BY price) AS median,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS p25,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS p75,
    min(price) AS min_price,
    max(price) AS max_price,
    count(*)   AS samples
FROM listings
WHERE detected_model ILIKE '%' || $1 || '%'
  AND ($2::text IS NULL OR vertical = $2)
  AND status = 'available';

-- median_price, split by platform (the version the tool returns).
SELECT platform,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median,
       count(*) AS samples
FROM listings
WHERE detected_model ILIKE '%' || $1 || '%'
  AND status = 'available'
GROUP BY platform
ORDER BY samples DESC;

-- asking vs sold: the signal that a system like this exists to surface.
-- (Asking price from live listings, sold price from detected sales.)
SELECT l.detected_model,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price)     AS asking_median,
       count(*) FILTER (WHERE l.status = 'available')           AS live_listings,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.sold_price)
          FROM sales s WHERE s.detected_model = l.detected_model) AS sold_median
FROM listings l
WHERE l.vertical = $1
GROUP BY l.detected_model
HAVING count(*) FILTER (WHERE l.status = 'available') >= 5
ORDER BY live_listings DESC;

-- opportunities: read the results of the upstream scoring step.
SELECT o.id, l.detected_model, l.price, o.margin, o.level
FROM opportunities o
JOIN listings l ON l.id = o.listing_id
WHERE ($1::text    IS NULL OR o.vertical = $1)
  AND ($2::numeric IS NULL OR o.margin  >= $2)
ORDER BY o.margin DESC
LIMIT $3;

-- classification coverage per vertical (a data-quality check).
SELECT vertical,
       count(*) AS total,
       round(100.0 * count(*) FILTER (WHERE COALESCE(item_type,'') <> '') / count(*), 1) AS pct_classified
FROM listings
GROUP BY vertical
ORDER BY pct_classified ASC;
