import type { ListingType, PropertyType, PropertyStatus } from '../../shared/enums';
import type { PropertyListItem } from '../properties/property.type';

// ── Query input (after Zod parsing) ──────────────────────────

export interface SearchQuery {
  // Full-text keyword search
  q?: string;

  // Location filters
  city?: string;
  locality?: string;
  state?: string;

  // Property filters
  listingType?: ListingType;
  propertyType?: PropertyType;
  bedrooms?: number[];        // multi-select: [2,3]
  bathrooms?: number;
  isFurnished?: boolean;

  // Budget filter
  priceMin?: number;
  priceMax?: number;

  // Area filter
  areaMin?: number;
  areaMax?: number;

  // Pagination
  cursor?: string;            // opaque cursor (encoded JSON)
  limit: number;

  // Sorting
  sortBy: SearchSortField;
  sortOrder: 'asc' | 'desc';
}

export type SearchSortField =
  | 'relevance'   // ts_rank — only valid when q is provided, else falls back to createdAt
  | 'price'
  | 'createdAt'
  | 'areaSqft'
  | 'viewCount';

// ── Cursor payload (encoded as base64 JSON in the response) ──

export interface CursorPayload {
  id: string;
  value: string | number;     // value of the sortBy field at the cursor position
  sortBy: SearchSortField;
  sortOrder: 'asc' | 'desc';
}

// ── Search result ─────────────────────────────────────────────

export interface SearchResult {
  data: PropertyListItem[];
  pagination: {
    nextCursor: string | null;  // base64-encoded CursorPayload
    hasMore: boolean;
    limit: number;
  };
  meta: {
    estimatedTotal: number;     // fast estimate via reltuples — not exact count()
    appliedFilters: string[];   // which filters were actually used
    searchTime: number;         // ms — exposed for debugging/monitoring
  };
}

// ── Facets (filter counts for the sidebar) ───────────────────

export interface SearchFacets {
  listingType: FacetBucket[];
  propertyType: FacetBucket[];
  bedrooms: FacetBucket[];
  priceRanges: PriceRangeBucket[];
  cities: FacetBucket[];
}

export interface FacetBucket {
  value: string | number;
  label: string;
  count: number;
}

export interface PriceRangeBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
}

// ── Autocomplete ─────────────────────────────────────────────

export interface AutocompleteResult {
  cities: string[];
  localities: string[];
}