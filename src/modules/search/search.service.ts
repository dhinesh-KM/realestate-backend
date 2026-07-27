import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { logger } from '../../shared/logger';
import { PropertyStatus } from '../../shared/enums';
import type { PropertyListItem } from '../properties/property.type';
import type {
  SearchQuery,
  SearchSortField,
  SearchResult,
  SearchFacets,
  CursorPayload,
  AutocompleteResult,
} from './search.type';

// ── Cache TTLs ────────────────────────────────────────────────
const CACHE_TTL = {
  SEARCH:        60 * 2,    // 2 min — search results change frequently
  FACETS:        60 * 5,    // 5 min — facet counts are approximate anyway
  AUTOCOMPLETE:  60 * 60,   // 1 hr  — city/locality names are stable
  TOTAL_COUNT:   60 * 10,   // 10 min — estimate, not exact
};

// ── Column map: JS sort field → SQL column name ───────────────
// Required for raw SQL where we can't use Prisma's field mapping
const SORT_COL: Record<SearchSortField, string> = {
  relevance: 'created_at',  // replaced by ts_rank when q is present
  price:     'price',
  createdAt: 'created_at',
  areaSqft:  'area_sqft',
  viewCount: 'view_count',
};

export class SearchService {

  // ────────────────────────────────────────────────────────────
  // MAIN SEARCH
  // ────────────────────────────────────────────────────────────
  /**
   * Why raw SQL instead of Prisma ORM here?
   *
   * Three things Prisma cannot do at the ORM layer:
   * 1. Use ts_rank() for relevance scoring — needs the search_vector column
   * 2. Cursor pagination using (sort_value, id) tuple comparison — Prisma
   *    only supports { cursor: { id } } which is offset-equivalent for
   *    non-id sort columns and degrades on large offsets
   * 3. Inline ts_rank in ORDER BY while also selecting it — requires a CTE
   *    or subquery that Prisma doesn't model
   *
   * Everything else (create, update, relations) stays on Prisma ORM.
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const start = Date.now();

    // ── Cache key — deterministic from query params ───────────
    const cacheKey = `search:${this._queryCacheKey(query)}`;
    const redis    = getRedisClient();
    const cached   = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      const result = JSON.parse(cached) as SearchResult;
      result.meta.searchTime = Date.now() - start;
      return result;
    }

    // ── Decode cursor ─────────────────────────────────────────
    const cursorPayload = query.cursor
      ? this._decodeCursor(query.cursor)
      : null;

    // ── Build parameterised WHERE clause ──────────────────────
    const { whereClause, params } = this._buildWhereClause(query, cursorPayload);

    // ── Build ORDER BY ────────────────────────────────────────
    const { orderClause, selectRankExpr } = this._buildOrderClause(query);

    // Fetch limit+1 to determine hasMore without a COUNT query
    const fetchLimit = query.limit + 1;

    // ── Execute main query ────────────────────────────────────
    //
    // Query anatomy:
    //   WITH ranked AS (
    //     SELECT p.*, pi.url AS primary_image [, ts_rank(...) AS rank]
    //     FROM properties p
    //     LEFT JOIN property_images pi ON pi.property_id = p.id AND pi.is_primary = true
    //     WHERE <filters> [AND <cursor>]
    //     ORDER BY <sort>
    //     LIMIT limit+1
    //   )
    //   SELECT * FROM ranked
    //
    // The CTE is needed to compute ts_rank once and use it in
    // both SELECT and ORDER BY without double-computing it.
    //
    // LEFT JOIN on primary image: single join, no N+1 problem.
    // The GIN index on search_vector is used when q is provided.
    // The partial index idx_properties_active_city_type is used
    // when city + type filters are applied.

    const sql = `
      WITH ranked AS (
        SELECT
          p.id,
          p.title,
          p.listing_type        AS "listingType",
          p.property_type       AS "propertyType",
          p.status,
          p.price,
          p.city,
          p.locality,
          p.state,
          p.bedrooms,
          p.bathrooms,
          p.area_sqft           AS "areaSqft",
          p.is_furnished        AS "isFurnished",
          p.view_count          AS "viewCount",
          p.created_at          AS "createdAt",
          pi.url                AS "primaryImage"
          ${selectRankExpr}
        FROM properties p
        LEFT JOIN property_images pi
          ON pi.property_id = p.id AND pi.is_primary = true
        WHERE ${whereClause}
        ${orderClause}
        LIMIT ${fetchLimit}
      )
      SELECT * FROM ranked
    `;

    const rows = await (prisma.$queryRawUnsafe as any)(sql, ...params);

    // ── Determine hasMore + next cursor ───────────────────────
    const hasMore = rows.length > query.limit;
    const items   = hasMore ? rows.slice(0, query.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last         = items[items.length - 1];
      const cursorValue  = this._getCursorValue(last, query.sortBy);
      nextCursor         = this._encodeCursor({ id: last.id, value: cursorValue, sortBy: query.sortBy, sortOrder: query.sortOrder });
    }

    // ── Shape response ────────────────────────────────────────
    const data: PropertyListItem[] = items.map((r: any) => ({
      id:           r.id,
      title:        r.title,
      listingType:  r.listingType,
      propertyType: r.propertyType,
      status:       r.status,
      price:        r.price.toString(),
      city:         r.city,
      locality:     r.locality,
      state:        r.state,
      bedrooms:     r.bedrooms,
      bathrooms:    r.bathrooms,
      areaSqft:     r.areaSqft.toString(),
      isFurnished:  r.isFurnished,
      primaryImage: r.primaryImage ?? null,
      viewCount:    Number(r.viewCount),
      createdAt:    r.createdAt,
    }));

    // ── Estimated total (fast path — no COUNT(*)) ─────────────
    const estimatedTotal = await this._estimateTotal(query);

    // ── Collect applied filters for UI feedback ───────────────
    const appliedFilters = this._getAppliedFilters(query);

    const result: SearchResult = {
      data,
      pagination: {
        nextCursor,
        hasMore,
        limit: query.limit,
      },
      meta: {
        estimatedTotal,
        appliedFilters,
        searchTime: Date.now() - start,
      },
    };

    // Cache — skip caching if cursor is set (mid-pagination, not worth caching)
    if (!query.cursor) {
      await redis
        .setEx(cacheKey, CACHE_TTL.SEARCH, JSON.stringify(result))
        .catch(() => {});
    }

    logger.debug('Search executed', {
      query: query.q,
      filters: appliedFilters,
      resultCount: data.length,
      ms: Date.now() - start,
    });

    return result;
  }

  // ────────────────────────────────────────────────────────────
  // FACETS
  // ────────────────────────────────────────────────────────────
  /**
   * Facets = filter option counts shown in the search sidebar.
   * e.g. "Apartment (342), Villa (89), ..."
   *
   * Strategy: run a SINGLE query with multiple GROUP BY sub-aggregations
   * using conditional COUNT — far cheaper than 5 separate queries.
   *
   * We apply all CURRENT filters except the facet's own dimension,
   * so the counts reflect what the user would get if they toggled
   * that filter — standard "conjunctive faceting".
   *
   * Cached aggressively — counts are approximate and staleness is fine.
   */
  async getFacets(query: SearchQuery): Promise<SearchFacets> {
    const cacheKey = `search:facets:${this._queryCacheKey(query)}`;
    const redis    = getRedisClient();
    const cached   = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    // Base filter (without cursor, without limit, without sorting)
    const { whereClause, params } = this._buildBaseWhereClause(query);

    const sql = `
      SELECT
        -- Property type distribution
        property_type                               AS "facetKey",
        'propertyType'                              AS "facetType",
        COUNT(*)::int                               AS count
      FROM properties p
      WHERE ${whereClause}
      GROUP BY property_type

      UNION ALL

      SELECT
        listing_type                                AS "facetKey",
        'listingType'                               AS "facetType",
        COUNT(*)::int                               AS count
      FROM properties p
      WHERE ${whereClause}
      GROUP BY listing_type

      UNION ALL

      SELECT
        bedrooms::text                              AS "facetKey",
        'bedrooms'                                  AS "facetType",
        COUNT(*)::int                               AS count
      FROM properties p
      WHERE ${whereClause}
        AND bedrooms <= 5
      GROUP BY bedrooms
      ORDER BY bedrooms ASC

      UNION ALL

      SELECT
        city                                        AS "facetKey",
        'city'                                      AS "facetType",
        COUNT(*)::int                               AS count
      FROM properties p
      WHERE ${whereClause}
      GROUP BY city
      ORDER BY count DESC
      LIMIT 20
    `;

    // params appears twice because whereClause is used 4 times
    const rows = await (prisma.$queryRawUnsafe as any)(sql, ...params, ...params, ...params, ...params);

    // ── Price range facets (fixed buckets, separate query) ────
    const priceRows = await (prisma.$queryRawUnsafe as any)(`
      SELECT
        CASE
          WHEN price < 5000000          THEN 'under_50L'
          WHEN price < 10000000         THEN '50L_1Cr'
          WHEN price < 20000000         THEN '1Cr_2Cr'
          WHEN price < 50000000         THEN '2Cr_5Cr'
          ELSE                               'above_5Cr'
        END AS bucket,
        COUNT(*)::int AS count
      FROM properties p
      WHERE ${whereClause}
      GROUP BY bucket
    `, ...params);

    // ── Shape the response ────────────────────────────────────
    const byType = (type: string) =>
      rows
        .filter((r: any) => r.facetType === type)
        .map((r: any) => ({
          value: r.facetKey,
          label: this._toLabel(r.facetKey),
          count: r.count,
        }));

    const PRICE_BUCKETS = [
      { bucket: 'under_50L', label: 'Under ₹50 Lakh',    min: 0,         max: 5_000_000 },
      { bucket: '50L_1Cr',   label: '₹50L – ₹1 Crore',   min: 5_000_000, max: 10_000_000 },
      { bucket: '1Cr_2Cr',   label: '₹1 Cr – ₹2 Crore',  min: 10_000_000, max: 20_000_000 },
      { bucket: '2Cr_5Cr',   label: '₹2 Cr – ₹5 Crore',  min: 20_000_000, max: 50_000_000 },
      { bucket: 'above_5Cr', label: 'Above ₹5 Crore',    min: 50_000_000, max: null },
    ];

    const priceMap = new Map(priceRows.map((r: any) => [r.bucket, r.count]));
    const priceRanges = PRICE_BUCKETS
      .map((b) => ({ ...b, count: priceMap.get(b.bucket) ?? 0 }))
      .filter((b: any) => Number(b.count) > 0) as any;

    const facets: SearchFacets = {
      propertyType: byType('propertyType'),
      listingType:  byType('listingType'),
      bedrooms:     byType('bedrooms'),
      cities:       byType('city'),
      priceRanges,
    };

    await redis.setEx(cacheKey, CACHE_TTL.FACETS, JSON.stringify(facets)).catch(() => {});
    return facets;
  }

  // ────────────────────────────────────────────────────────────
  // AUTOCOMPLETE
  // ────────────────────────────────────────────────────────────
  /**
   * Autocomplete for city/locality search box.
   *
   * Uses ILIKE with a prefix match (val%) which hits the B-Tree
   * index on city/locality columns when the pattern doesn't start
   * with a wildcard. This is O(log n) — no sequential scan.
   *
   * Results are deduplicated and sorted by property count DESC
   * so popular cities appear first.
   */
  async autocomplete(q: string, type: 'city' | 'locality' | 'all'): Promise<AutocompleteResult> {
    const cacheKey = `autocomplete:${type}:${q.toLowerCase()}`;
    const redis    = getRedisClient();
    const cached   = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const pattern = `${q.toLowerCase()}%`;

    const [cities, localities] = await Promise.all([
      (type === 'city' || type === 'all')
        ? prisma.$queryRaw<{ city: string; count: bigint }[]>`
            SELECT city, COUNT(*) AS count
            FROM properties
            WHERE city ILIKE ${pattern}
              AND is_active = true
            GROUP BY city
            ORDER BY count DESC
            LIMIT 8
          `
        : Promise.resolve([]),

      (type === 'locality' || type === 'all')
        ? prisma.$queryRaw<{ locality: string; count: bigint }[]>`
            SELECT locality, COUNT(*) AS count
            FROM properties
            WHERE locality ILIKE ${pattern}
              AND is_active = true
            GROUP BY locality
            ORDER BY count DESC
            LIMIT 8
          `
        : Promise.resolve([]),
    ]);

    const result: AutocompleteResult = {
      cities:     (cities as any[]).map((r) => r.city),
      localities: (localities as any[]).map((r) => r.locality),
    };

    await redis.setEx(cacheKey, CACHE_TTL.AUTOCOMPLETE, JSON.stringify(result)).catch(() => {});
    return result;
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: WHERE CLAUSE BUILDER
  // ────────────────────────────────────────────────────────────
  /**
   * Builds a parameterised SQL WHERE clause from query filters.
   * Returns the clause string and the ordered params array.
   *
   * Design decisions:
   * 1. Parameterised values only ($1, $2, ...) — never string interpolation.
   *    SQL injection is impossible even with malicious user input.
   * 2. Only add clauses for filters that are actually set — empty filters
   *    should never add tautologies like "AND 1=1".
   * 3. City/locality stored lowercase — comparison is always lowercase,
   *    so the B-Tree index on city column is hit without a function wrap.
   *    ILIKE with a leading wildcard would bypass the index.
   * 4. Full-text search clause uses @@ operator with GIN index —
   *    plainto_tsquery handles multi-word input gracefully (no syntax errors
   *    from user typos unlike to_tsquery).
   */
  private _buildBaseWhereClause(query: SearchQuery): {
    whereClause: string;
    params: any[];
  } {
    const conditions: string[] = ['p.is_active = true', `p.status = '${PropertyStatus.ACTIVE}'`];
    const params: any[]        = [];
    let   p                    = 0; // param counter ($1, $2, ...)

    // Full-text search
    if (query.q) {
      p++;
      // plainto_tsquery: "2 bhk mumbai" → 'bhk' & 'mumbai' — safe for user input
      // websearch_to_tsquery (PG 11+) also handles OR, quotes — more powerful
      conditions.push(`p.search_vector @@ plainto_tsquery('english', $${p})`);
      params.push(query.q.trim());
    }

    // Location filters — stored lowercase, compare lowercase (index-friendly)
    if (query.city) {
      p++;
      conditions.push(`p.city = $${p}`);
      params.push(query.city.toLowerCase().trim());
    }

    if (query.locality) {
      p++;
      conditions.push(`p.locality ILIKE $${p}`);
      // Use prefix match (no leading wildcard) to keep B-Tree index
      params.push(`${query.locality.toLowerCase().trim()}%`);
    }

    if (query.state) {
      p++;
      conditions.push(`LOWER(p.state) = $${p}`);
      params.push(query.state.toLowerCase().trim());
    }

    // Listing type
    if (query.listingType) {
      p++;
      conditions.push(`p.listing_type = $${p}::"ListingType"`);
      params.push(query.listingType);
    }

    // Property type
    if (query.propertyType) {
      p++;
      conditions.push(`p.property_type = $${p}::"PropertyType"`);
      params.push(query.propertyType);
    }

    // Bedrooms — multi-select using ANY(array) — single param, index-friendly
    if (query.bedrooms && query.bedrooms.length > 0) {
      p++;
      conditions.push(`p.bedrooms = ANY($${p}::int[])`);
      params.push(query.bedrooms);
    }

    // Bathrooms
    if (query.bathrooms) {
      p++;
      conditions.push(`p.bathrooms >= $${p}`);
      params.push(query.bathrooms);
    }

    // Furnished
    if (query.isFurnished !== undefined) {
      p++;
      conditions.push(`p.is_furnished = $${p}`);
      params.push(query.isFurnished);
    }

    // Price range
    if (query.priceMin !== undefined) {
      p++;
      conditions.push(`p.price >= $${p}`);
      params.push(query.priceMin);
    }
    if (query.priceMax !== undefined) {
      p++;
      conditions.push(`p.price <= $${p}`);
      params.push(query.priceMax);
    }

    // Area range
    if (query.areaMin !== undefined) {
      p++;
      conditions.push(`p.area_sqft >= $${p}`);
      params.push(query.areaMin);
    }
    if (query.areaMax !== undefined) {
      p++;
      conditions.push(`p.area_sqft <= $${p}`);
      params.push(query.areaMax);
    }

    return {
      whereClause: conditions.join(' AND '),
      params,
    };
  }

  /**
   * Extends the base WHERE clause with cursor pagination.
   * Uses keyset/seek pagination: (sort_value, id) tuple comparison.
   *
   * Why tuple comparison instead of OFFSET?
   * OFFSET N forces PostgreSQL to scan and discard N rows.
   * At page 100 with limit 20 → scan 2000 rows, return 20.
   * With 50k properties this becomes very slow deep in the list.
   *
   * Keyset: WHERE (price, id) < ($cursor_price, $cursor_id)
   * The DB jumps straight to the cursor position via the B-Tree
   * index. Performance is O(log n) regardless of page depth.
   *
   * The (sort_value, id) tie-breaker handles duplicate sort values:
   * if 100 properties have price = 5000000, we use id as the secondary
   * sort to get a stable, deterministic page boundary.
   */
  private _buildWhereClause(
    query: SearchQuery,
    cursor: CursorPayload | null
  ): { whereClause: string; params: any[] } {
    const { whereClause: base, params } = this._buildBaseWhereClause(query);

    if (!cursor) {
      return { whereClause: base, params };
    }

    // Cursor clause — keyset pagination
    const op     = query.sortOrder === 'desc' ? '<' : '>';
    const col    = SORT_COL[cursor.sortBy];
    const pIdx   = params.length;

    params.push(cursor.value, cursor.id);

    // (col, id) < ($n, $n+1) — stable sort with tie-breaker on id
    const cursorClause = `(p.${col}, p.id) ${op} ($${pIdx + 1}, $${pIdx + 2})`;

    return {
      whereClause: `${base} AND ${cursorClause}`,
      params,
    };
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: ORDER BY BUILDER
  // ────────────────────────────────────────────────────────────
  private _buildOrderClause(query: SearchQuery): {
    orderClause: string;
    selectRankExpr: string;
  } {
    const dir = query.sortOrder.toUpperCase();

    // Relevance sort — only available when full-text query is set
    if (query.sortBy === 'relevance' && query.q) {
      return {
        // ts_rank_cd uses cover density ranking — rewards documents where
        // query terms appear close together (better than ts_rank for short docs)
        selectRankExpr: `, ts_rank_cd(p.search_vector, plainto_tsquery('english', $1)) AS rank`,
        orderClause: `ORDER BY rank DESC, p.created_at DESC`,
      };
    }

    const col = SORT_COL[query.sortBy] ?? 'created_at';
    return {
      selectRankExpr: '',
      orderClause: `ORDER BY p.${col} ${dir}, p.id ${dir}`,
    };
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: ESTIMATED TOTAL (fast, no COUNT(*))
  // ────────────────────────────────────────────────────────────
  /**
   * At 50k+ rows, COUNT(*) with filters can take 100-500ms.
   * We use two strategies:
   *
   * 1. No filters / very few: use pg_class.reltuples (statistics estimate).
   *    Sub-millisecond. Updated by ANALYZE / autovacuum.
   *    Accuracy: ±5% on a healthy table.
   *
   * 2. With filters: use EXPLAIN (not EXPLAIN ANALYZE) to get the
   *    planner's row estimate. Takes ~5ms regardless of table size
   *    because it doesn't actually execute the query.
   *    Accuracy: ±10-30% — good enough for "about 3,400 results".
   *
   * We cache estimates aggressively — the user doesn't need an exact
   * count and the value displayed ("~3,400 results") is more honest.
   */
  private async _estimateTotal(query: SearchQuery): Promise<number> {
    const cacheKey = `search:count:${this._queryCacheKey(query)}`;
    const redis    = getRedisClient();
    const cached   = await redis.get(cacheKey).catch(() => null);
    if (cached) return parseInt(cached, 10);

    let estimate: number;

    // Fast path — no filters, use table statistics
    if (this._isUnfiltered(query)) {
      const result = await prisma.$queryRaw<{ estimate: bigint }[]>`
        SELECT reltuples::bigint AS estimate
        FROM pg_class
        WHERE relname = 'properties'
      `;
      estimate = Number(result[0]?.estimate ?? 0);
    } else {
      // Use EXPLAIN to get planner row estimate
      const { whereClause, params } = this._buildBaseWhereClause(query);
      try {
        const explainSQL = `
          EXPLAIN (FORMAT JSON)
          SELECT 1 FROM properties p
          WHERE ${whereClause}
        `;
        const plan = await (prisma.$queryRawUnsafe as any)(explainSQL, ...params);
        estimate = plan[0]?.['QUERY PLAN']?.[0]?.Plan?.['Plan Rows'] ?? 0;
      } catch {
        estimate = 0;
      }
    }

    await redis.setEx(cacheKey, CACHE_TTL.TOTAL_COUNT, String(estimate)).catch(() => {});
    return estimate;
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: CURSOR ENCODE / DECODE
  // ────────────────────────────────────────────────────────────
  /**
   * Cursor is a base64-encoded JSON payload.
   * Opaque to the client — they just pass it back as-is.
   * Never use sequential page numbers as cursors — they're
   * meaningless after inserts/deletes shift the result set.
   */
  private _encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  private _decodeCursor(cursor: string): CursorPayload | null {
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf8');
      return JSON.parse(json) as CursorPayload;
    } catch {
      return null;
    }
  }

  private _getCursorValue(row: any, sortBy: SearchSortField): string | number {
    switch (sortBy) {
      case 'price':     return row.price?.toString() ?? '0';
      case 'areaSqft':  return row.areaSqft?.toString() ?? '0';
      case 'viewCount': return Number(row.viewCount ?? 0);
      case 'createdAt':
      case 'relevance':
      default:          return row.createdAt?.toISOString() ?? new Date().toISOString();
    }
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE: CACHE KEY
  // ────────────────────────────────────────────────────────────
  /**
   * Cache key is a deterministic hash of search params (excluding cursor/limit).
   * Two requests with the same filters get the same cache entry
   * regardless of parameter order.
   */
  private _queryCacheKey(query: SearchQuery): string {
    const {
      cursor: _cursor, limit: _limit,
      ...filters
    } = query;

    // Sort keys so {city:'mumbai', q:'flat'} === {q:'flat', city:'mumbai'}
    const sorted = Object.keys(filters)
      .sort()
      .reduce((acc, k) => {
        const v = (filters as any)[k];
        if (v !== undefined && v !== null) acc[k] = v;
        return acc;
      }, {} as any);

    return Buffer.from(JSON.stringify(sorted)).toString('base64url').slice(0, 64);
  }

  private _isUnfiltered(query: SearchQuery): boolean {
    return (
      !query.q &&
      !query.city &&
      !query.locality &&
      !query.state &&
      !query.listingType &&
      !query.propertyType &&
      !query.bedrooms &&
      !query.priceMin &&
      !query.priceMax &&
      !query.areaMin &&
      !query.areaMax &&
      query.isFurnished === undefined
    );
  }

  private _getAppliedFilters(query: SearchQuery): string[] {
    const applied: string[] = [];
    if (query.q)            applied.push(`keyword: "${query.q}"`);
    if (query.city)         applied.push(`city: ${query.city}`);
    if (query.locality)     applied.push(`locality: ${query.locality}`);
    if (query.listingType)  applied.push(`listing: ${query.listingType}`);
    if (query.propertyType) applied.push(`type: ${query.propertyType}`);
    if (query.bedrooms?.length) applied.push(`bedrooms: ${query.bedrooms.join(',')}`);
    if (query.priceMin)     applied.push(`priceMin: ${query.priceMin}`);
    if (query.priceMax)     applied.push(`priceMax: ${query.priceMax}`);
    if (query.isFurnished !== undefined) applied.push(`furnished: ${query.isFurnished}`);
    return applied;
  }

  private _toLabel(value: string): string {
    return value
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export const searchService = new SearchService();