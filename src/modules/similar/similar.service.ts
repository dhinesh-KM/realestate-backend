import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { logger } from '../../shared/logger';
import { rankCandidates } from './similar.scoring';
import type {
  ReferenceProperty,
  SimilarPropertiesResult,
  ScoredCandidate,
} from './similar.type';
import { SIMILAR_COUNT } from './similar.type';

// ── Cache config ──────────────────────────────────────────────

const CACHE = {
  // Primary cache: similar results per property
  SIMILAR_KEY:   (id: string) => `similar:v2:${id}`,
  SIMILAR_TTL:   60 * 30,      // 30 min — similar properties don't change often

  // Warm-up lock: prevent stampede when cache expires
  WARMUP_KEY:    (id: string) => `similar:warming:${id}`,
  WARMUP_TTL:    30,            // 30s lock — one warmer at a time

  // Reference property fields: cached separately so scoring
  // can run without a DB round-trip on cache hit
  REF_KEY:       (id: string) => `similar:ref:${id}`,
  REF_TTL:       60 * 60,      // 1 hr — property attrs don't change often
};

// ── Candidate SQL select columns ──────────────────────────────
// Minimal projection — only what the scoring engine and response need.
// No description, no full image list, no owner details.

const CANDIDATE_COLUMNS = `
  p.id,
  p.title,
  p.listing_type    AS "listingType",
  p.property_type   AS "propertyType",
  p.status,
  p.price,
  p.city,
  p.locality,
  p.state,
  p.bedrooms,
  p.bathrooms,
  p.area_sqft       AS "areaSqft",
  p.is_furnished    AS "isFurnished",
  p.view_count      AS "viewCount",
  p.created_at      AS "createdAt",
  p.latitude,
  p.longitude,
  pi.url            AS "primaryImage"
`;

// ─────────────────────────────────────────────────────────────

export class SimilarPropertyService {

  // ────────────────────────────────────────────────────────────
  // PUBLIC: GET SIMILAR PROPERTIES
  // ────────────────────────────────────────────────────────────
  /**
   * Three-tier strategy:
   *
   * Tier 1 — Cache hit (Redis, ~0.5ms)
   *   Return immediately. Trigger background re-warm if TTL < 5 min.
   *
   * Tier 2 — Primary algorithm (PostgreSQL weighted query + Node scoring)
   *   Fetch ~50 pre-filtered candidates in one SQL query.
   *   Re-score with geo signal (haversine) and human-readable reasons.
   *   Returns top SIMILAR_COUNT by score.
   *
   * Tier 3 — Fallback (if primary returns < 3 results)
   *   Fall back progressively:
   *   3a. Same city, same listing type (any property type/bedrooms)
   *   3b. Same property type nationwide (last resort)
   *   Ensures the section is never empty.
   */
  async getSimilarProperties(propertyId: string): Promise<SimilarPropertiesResult> {
    const redis = getRedisClient();

    // ── Tier 1: Cache ─────────────────────────────────────────
    const cacheKey = CACHE.SIMILAR_KEY(propertyId);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as SimilarPropertiesResult;

        // Background re-warm if TTL is under 5 minutes
        const ttl = await redis.ttl(cacheKey);
        if (ttl > 0 && ttl < 300) {
          this._backgroundWarm(propertyId).catch(() => {});
        }

        return result;
      }
    } catch {
      // Redis unavailable — continue to DB
    }

    // ── Fetch reference property ──────────────────────────────
    const ref = await this._getReference(propertyId);
    if (!ref) {
      return { properties: [], algorithm: 'weighted_score', totalScored: 0 };
    }

    // ── Tier 2: Primary weighted algorithm ────────────────────
    const primary = await this._primaryAlgorithm(ref);

    if (primary.properties.length >= 3) {
      await this._cache(cacheKey, primary);
      return primary;
    }

    // ── Tier 3a: Same city fallback ───────────────────────────
    logger.debug('Similar: primary returned < 3, trying city fallback', {
      propertyId, count: primary.properties.length,
    });

    const existingIds = new Set(primary.properties.map((p) => p.id));
    const cityFallback = await this._cityFallback(ref, existingIds);

    const merged3a = this._merge(primary.properties, cityFallback, SIMILAR_COUNT);
    if (merged3a.length >= 3) {
      const result: SimilarPropertiesResult = {
        properties:  merged3a,
        algorithm:   'fallback_city',
        totalScored: primary.totalScored + cityFallback.length,
      };
      await this._cache(cacheKey, result);
      return result;
    }

    // ── Tier 3b: Same type fallback ───────────────────────────
    logger.debug('Similar: city fallback returned < 3, trying type fallback', {
      propertyId, count: merged3a.length,
    });

    const allExistingIds = new Set(merged3a.map((p) => p.id));
    const typeFallback   = await this._typeFallback(ref, allExistingIds);
    const merged3b       = this._merge(merged3a, typeFallback, SIMILAR_COUNT);

    const result: SimilarPropertiesResult = {
      properties:  merged3b,
      algorithm:   'fallback_type',
      totalScored: primary.totalScored + cityFallback.length + typeFallback.length,
    };
    await this._cache(cacheKey, result);
    return result;
  }

  // ────────────────────────────────────────────────────────────
  // CACHE INVALIDATION (called when a property is updated/deleted)
  // ────────────────────────────────────────────────────────────
  async invalidate(propertyId: string): Promise<void> {
    const redis = getRedisClient();
    await Promise.allSettled([
      redis.del(CACHE.SIMILAR_KEY(propertyId)),
      redis.del(CACHE.REF_KEY(propertyId)),
    ]);
  }

  // ────────────────────────────────────────────────────────────
  // CACHE WARM-UP (call after property creation or on schedule)
  // ────────────────────────────────────────────────────────────
  /**
   * Pre-warm the cache for a property.
   *
   * Used in two places:
   * 1. After a new property is created — so the first visitor
   *    to the detail page gets a cache hit, not a cold query.
   * 2. As a background job on popular properties (high viewCount)
   *    so the cache never expires under load.
   *
   * The WARMUP lock prevents cache stampede: if 100 concurrent
   * requests arrive when the cache expires, only one triggers
   * the warm-up. The other 99 get a brief stale response (or
   * compute it themselves — acceptable under high load).
   */
  async warmUp(propertyId: string): Promise<void> {
    const redis = getRedisClient();

    // Acquire warm-up lock — only one warmer at a time
    const lockKey = CACHE.WARMUP_KEY(propertyId);
    const locked  = await redis.set(lockKey, '1', { NX: true, EX: CACHE.WARMUP_TTL });
    if (!locked) return; // another process is already warming

    try {
      await this.getSimilarProperties(propertyId);
      logger.debug('Cache warmed', { propertyId });
    } finally {
      await redis.del(lockKey);
    }
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: REFERENCE PROPERTY
  // ────────────────────────────────────────────────────────────
  private async _getReference(propertyId: string): Promise<ReferenceProperty | null> {
    const redis    = getRedisClient();
    const refKey   = CACHE.REF_KEY(propertyId);

    // Check reference cache first — avoids a DB read on every similar query
    try {
      const cached = await redis.get(refKey);
      if (cached) return JSON.parse(cached) as ReferenceProperty;
    } catch { /* Redis down */ }

    const raw = await prisma.property.findUnique({
      where:  { id: propertyId, isActive: true },
      select: {
        id: true, city: true, locality: true, state: true,
        propertyType: true, listingType: true,
        bedrooms: true, bathrooms: true,
        price: true, areaSqft: true,
        isFurnished: true, latitude: true, longitude: true,
      },
    });

    if (!raw) return null;

    const ref: ReferenceProperty = {
      ...raw,
      price:    Number(raw.price),
      areaSqft: Number(raw.areaSqft),
      latitude:  raw.latitude  ? Number(raw.latitude)  : null,
      longitude: raw.longitude ? Number(raw.longitude) : null,
    };

    redis.setEx(refKey, CACHE.REF_TTL, JSON.stringify(ref)).catch(() => {});
    return ref;
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: PRIMARY ALGORITHM
  // ────────────────────────────────────────────────────────────
  /**
   * Fetch a pool of ~50 pre-filtered candidates from PostgreSQL,
   * then re-score them in Node with the full scoring engine.
   *
   * Why fetch 50 in SQL and re-score in Node?
   *
   * The SQL query uses indexed columns (city, property_type, bedrooms,
   * price range) to narrow the candidate pool cheaply. It can't compute
   * haversine distance without PostGIS, and the full scoring formula
   * in SQL is hard to maintain. So:
   *
   *   SQL = cheap pre-filter using indexes  (returns ~50 rows)
   *   Node = full scoring with geo + reasons (scores 50 rows in <1ms)
   *
   * This keeps the SQL simple and the scoring logic testable.
   *
   * The SQL query is structured to hit the composite index
   * idx_properties_active_city_type defined in the migration:
   *   (city, property_type, listing_type, bedrooms) WHERE is_active = true
   */
  private async _primaryAlgorithm(ref: ReferenceProperty): Promise<SimilarPropertiesResult> {
    // Pre-filter: same city OR same type+listing — broad enough to get 50 candidates
    // Price window ±40% in SQL (Node re-scores to ±20% / ±10%)
    const priceMin = ref.price * 0.6;
    const priceMax = ref.price * 1.4;

    const candidates = await prisma.$queryRaw<any[]>`
      SELECT ${prisma.$queryRaw(CANDIDATE_COLUMNS)}
      FROM   properties p
      LEFT   JOIN property_images pi
               ON pi.property_id = p.id AND pi.is_primary = true
      WHERE  p.id          != ${ref.id}::uuid
        AND  p.is_active    = true
        AND  p.listing_type = ${ref.listingType}::"ListingType"
        AND  (
               p.city          = ${ref.city}
            OR p.property_type = ${ref.propertyType}::"PropertyType"
        )
        AND  p.price BETWEEN ${priceMin} AND ${priceMax}
      ORDER  BY
               -- Prefer same city, then same locality — guides the pool
               CASE WHEN p.city     = ${ref.city}     THEN 0 ELSE 1 END,
               CASE WHEN p.locality = ${ref.locality}  THEN 0 ELSE 1 END,
               p.created_at DESC
      LIMIT  50
    `;

    const ranked = rankCandidates(ref, candidates, SIMILAR_COUNT);

    return {
      properties:  ranked,
      algorithm:   'weighted_score',
      totalScored: candidates.length,
    };
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: CITY FALLBACK (Tier 3a)
  // ────────────────────────────────────────────────────────────
  /**
   * Triggered when primary < 3 results.
   * Relaxes: removes price window and bedroom constraint.
   * Keeps: same city + same listing type.
   * Excludes already-found IDs.
   */
  private async _cityFallback(
    ref: ReferenceProperty,
    excludeIds: Set<string>
  ): Promise<ScoredCandidate[]> {
    const candidates = await prisma.$queryRaw<any[]>`
      SELECT ${prisma.$queryRaw(CANDIDATE_COLUMNS)}
      FROM   properties p
      LEFT   JOIN property_images pi
               ON pi.property_id = p.id AND pi.is_primary = true
      WHERE  p.id          != ${ref.id}::uuid
        AND  p.id          != ALL(${[...excludeIds]}::uuid[])
        AND  p.is_active    = true
        AND  p.city         = ${ref.city}
        AND  p.listing_type = ${ref.listingType}::"ListingType"
      ORDER  BY p.view_count DESC, p.created_at DESC
      LIMIT  20
    `;

    return rankCandidates(ref, candidates, SIMILAR_COUNT);
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: TYPE FALLBACK (Tier 3b)
  // ────────────────────────────────────────────────────────────
  /**
   * Last resort — same property type, same listing type, any city.
   * Used when the property is in a low-inventory area.
   * These results are least similar, hence placed last.
   */
  private async _typeFallback(
    ref: ReferenceProperty,
    excludeIds: Set<string>
  ): Promise<ScoredCandidate[]> {
    const excludeArr = [...excludeIds];

    const candidates = await prisma.$queryRaw<any[]>`
      SELECT ${prisma.$queryRaw(CANDIDATE_COLUMNS)}
      FROM   properties p
      LEFT   JOIN property_images pi
               ON pi.property_id = p.id AND pi.is_primary = true
      WHERE  p.id            != ${ref.id}::uuid
        AND  p.id            != ALL(${excludeArr.length > 0 ? excludeArr : ['00000000-0000-0000-0000-000000000000']}::uuid[])
        AND  p.is_active      = true
        AND  p.property_type  = ${ref.propertyType}::"PropertyType"
        AND  p.listing_type   = ${ref.listingType}::"ListingType"
      ORDER  BY p.view_count DESC, p.created_at DESC
      LIMIT  10
    `;

    // Apply a score floor discount for type-only fallbacks
    // (they're not geographically relevant)
    return rankCandidates(ref, candidates, SIMILAR_COUNT)
      .map((c) => ({ ...c, similarityScore: Math.min(c.similarityScore, 30) }));
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: HELPERS
  // ────────────────────────────────────────────────────────────

  /** Merge two ranked lists, deduplicate by id, cap at limit */
  private _merge(
    primary:   ScoredCandidate[],
    secondary: ScoredCandidate[],
    limit:     number
  ): ScoredCandidate[] {
    const seen = new Set(primary.map((p) => p.id));
    const extra = secondary.filter((p) => !seen.has(p.id));
    return [...primary, ...extra].slice(0, limit);
  }

  private async _cache(key: string, result: SimilarPropertiesResult): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setEx(key, CACHE.SIMILAR_TTL, JSON.stringify(result));
    } catch { /* non-critical */ }
  }

  private async _backgroundWarm(propertyId: string): Promise<void> {
    // Small delay so the current request isn't held up
    setTimeout(() => this.warmUp(propertyId).catch(() => {}), 100);
  }
}

export const similarPropertyService = new SimilarPropertyService();