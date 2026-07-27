-- ─────────────────────────────────────────────────────────────
-- Migration 001 — initial schema + production indexes
-- Run AFTER prisma migrate dev creates the base tables.
-- ─────────────────────────────────────────────────────────────

-- ── Full-text search index (GIN on tsvector) ─────────────────
--
-- Why not Elasticsearch at this scale?
-- PostgreSQL FTS handles 500k+ rows fine with a GIN index.
-- No extra infra, no sync lag, transactions are consistent.
--
-- search_vector is a generated column PostgreSQL maintains
-- automatically on INSERT/UPDATE. Weight breakdown:
--   A (highest) = title      — exact title match matters most
--   B           = locality   — location is the second key signal
--   C           = city       — broader location
--   D (lowest)  = description — keyword density, less precise
--
-- GIN index makes @@ queries sub-millisecond even at 200k rows.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title,       '')), 'A') ||
      setweight(to_tsvector('english', coalesce(locality,    '')), 'B') ||
      setweight(to_tsvector('english', coalesce(city,        '')), 'C') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'D')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_properties_search_vector
  ON properties USING GIN (search_vector);

-- ── Partial indexes ───────────────────────────────────────────
--
-- Partial indexes only index rows matching the WHERE clause.
-- At 50k properties, if 80% are active, a partial index on
-- active rows is ~80% smaller than a full index — much faster
-- scans, less memory pressure on shared_buffers.
--
-- Prisma schema @@index cannot express WHERE clauses, so these
-- must live in raw SQL migrations.

-- Primary index for the listing feed (active only, newest first)
CREATE INDEX IF NOT EXISTS idx_properties_active_feed
  ON properties (created_at DESC, id DESC)
  WHERE is_active = true;

-- Price search on active listings only
CREATE INDEX IF NOT EXISTS idx_properties_active_price
  ON properties (price, listing_type)
  WHERE is_active = true;

-- City + type search on active only (most common combo)
CREATE INDEX IF NOT EXISTS idx_properties_active_city_type
  ON properties (city, property_type, listing_type, bedrooms)
  WHERE is_active = true;

-- Bedroom filter on active only
CREATE INDEX IF NOT EXISTS idx_properties_active_bedrooms
  ON properties (bedrooms, city)
  WHERE is_active = true;

-- Refresh token validation — only non-revoked tokens need fast lookup.
-- Revoked tokens are cold data — no index needed.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_valid
  ON refresh_tokens (token_hash, expires_at)
  WHERE is_revoked = false;

-- ── Statistics hint for query planner ────────────────────────
--
-- Tells PostgreSQL to collect more granular statistics on city
-- and property_type columns — critical for accurate row estimates
-- in multi-column queries. Default is 100 buckets; 500 gives
-- much better cardinality estimates for filter planning.

ALTER TABLE properties
  ALTER COLUMN city         SET STATISTICS 500,
  ALTER COLUMN property_type SET STATISTICS 500,
  ALTER COLUMN listing_type SET STATISTICS 500,
  ALTER COLUMN bedrooms     SET STATISTICS 300;

-- Recompute statistics immediately after schema change
ANALYZE properties;

-- ── Comments for DBAs ─────────────────────────────────────────
COMMENT ON INDEX idx_properties_search_vector IS
  'GIN index on tsvector generated column. Powers full-text search across title/locality/city/description with weighted relevance ranking.';

COMMENT ON INDEX idx_properties_active_feed IS
  'Partial index (WHERE is_active=true). Primary index for the listing feed endpoint. Covers ORDER BY created_at DESC, id DESC with zero inactive row overhead.';

COMMENT ON INDEX idx_properties_active_city_type IS
  'Partial index for the most common filter combination: city + property_type + listing_type + bedrooms. Used by ~60% of all search queries.';