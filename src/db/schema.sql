-- Schema (generic) for the market-intelligence pipeline.
--
-- This is a simplified, sanitized version that shows the SHAPE of the data model:
-- how raw listings are ingested, classified, valued, and turned into opportunities,
-- plus the incident table that powers operational observability.
--
-- The real system has more columns and the scoring/valuation logic is not included.
-- Names are generic on purpose.

-- ---------------------------------------------------------------------------
-- Core: every listing seen across marketplaces.
-- Ingest -> classify -> value all update rows here. This table is the source of truth.
-- ---------------------------------------------------------------------------
CREATE TABLE listings (
    id              BIGSERIAL PRIMARY KEY,
    external_id     TEXT NOT NULL,                 -- id on the source marketplace
    platform        TEXT NOT NULL,                 -- market_a / market_b / ...
    vertical        TEXT NOT NULL,                 -- pc / bike / machinery / laptop
    title           TEXT NOT NULL,
    price           NUMERIC(10,2),
    status          TEXT NOT NULL DEFAULT 'available',  -- available / reserved / sold / removed
    item_type       TEXT,                          -- filled by the classifier (NULL = unclassified)
    detected_model  TEXT,                          -- normalized model, e.g. 'rtx 4070'
    estimated_value NUMERIC(10,2),                 -- output of the (private) valuation step
    extra           JSONB DEFAULT '{}'::jsonb,     -- flags: suspicious, broken, level, ...
    seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (platform, external_id)
);

CREATE INDEX idx_listings_vertical      ON listings (vertical);
CREATE INDEX idx_listings_status        ON listings (status);
CREATE INDEX idx_listings_model         ON listings (detected_model);
CREATE INDEX idx_listings_seen_at       ON listings (seen_at);
CREATE INDEX idx_listings_extra         ON listings USING gin (extra);

-- ---------------------------------------------------------------------------
-- Confirmed sales: listings observed to have sold (state transition detected).
-- Used to build a "sold price" signal distinct from the "asking price".
-- ---------------------------------------------------------------------------
CREATE TABLE sales (
    id              BIGSERIAL PRIMARY KEY,
    listing_id      BIGINT REFERENCES listings (id),
    vertical        TEXT NOT NULL,
    detected_model  TEXT,
    sold_price      NUMERIC(10,2),
    days_to_sale    INT,
    source          TEXT NOT NULL DEFAULT 'scraper',
    event_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_vertical ON sales (vertical);
CREATE INDEX idx_sales_model    ON sales (detected_model);

-- ---------------------------------------------------------------------------
-- Opportunities: listings flagged as worth acting on by the (private) scoring step.
-- The agent only READS this table.
-- ---------------------------------------------------------------------------
CREATE TABLE opportunities (
    id              BIGSERIAL PRIMARY KEY,
    listing_id      BIGINT REFERENCES listings (id),
    vertical        TEXT NOT NULL,
    margin          NUMERIC(10,2),                 -- computed upstream; not shown here
    level           TEXT,                          -- generic action level
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_opportunities_vertical ON opportunities (vertical);
CREATE INDEX idx_opportunities_margin   ON opportunities (margin DESC);

-- ---------------------------------------------------------------------------
-- Incidents: every watchdog alert is written here, so the failure history is
-- queryable and can be charted (observability as data).
-- ---------------------------------------------------------------------------
CREATE TABLE incidents (
    id          BIGSERIAL PRIMARY KEY,
    check_name  TEXT NOT NULL,
    type        TEXT NOT NULL,                     -- e.g. OPEN / RESOLVED / STALE
    vertical    TEXT,
    message     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_created ON incidents (created_at DESC);

-- ---------------------------------------------------------------------------
-- Least-privilege: the agent connects as a read-only role. Even a bad query
-- cannot modify data - the permission model enforces it, not a prompt.
-- ---------------------------------------------------------------------------
-- CREATE ROLE agent_reader LOGIN PASSWORD '...';
-- GRANT CONNECT ON DATABASE market_intel TO agent_reader;
-- GRANT USAGE ON SCHEMA public TO agent_reader;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_reader;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO agent_reader;
