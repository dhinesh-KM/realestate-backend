import { Router } from 'express';
import { searchController } from './search.controller';
import { optionalAuthenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { searchQuerySchema, autocompleteSchema } from './search.validation';

const router = Router();

/**
 * GET /search
 *
 * Main search endpoint. Supports:
 *   - Full-text keyword search   (?q=2bhk flat near metro)
 *   - Location filter            (?city=mumbai&locality=bandra)
 *   - Budget filter              (?priceMin=5000000&priceMax=20000000)
 *   - Property type filter       (?propertyType=APARTMENT)
 *   - Bedroom multi-select       (?bedrooms=2,3)
 *   - Sorting                    (?sortBy=price&sortOrder=asc)
 *   - Cursor pagination          (?cursor=<opaque>&limit=20)
 *
 * All filters are combinable. Missing filters are ignored — no 
 * tautologies or empty WHERE clauses.
 *
 * Response includes:
 *   - data[]         — page of property list items
 *   - pagination     — nextCursor, hasMore, limit
 *   - meta           — estimatedTotal, appliedFilters, searchTime
 */
router.get(
  '/',
  optionalAuthenticate,
  validate({ query: searchQuerySchema }),
  asyncHandler(searchController.search.bind(searchController))
);

/**
 * GET /search/facets
 *
 * Returns filter option counts for the search sidebar.
 * Uses the same filter params as /search (minus cursor/limit/sort).
 * Designed to be called in parallel with /search, not sequentially.
 *
 * Response includes:
 *   - propertyType[]  — type distribution
 *   - listingType[]   — rent vs sale counts
 *   - bedrooms[]      — bedroom distribution
 *   - priceRanges[]   — fixed budget bucket counts
 *   - cities[]        — top matching cities
 */
router.get(
  '/facets',
  validate({ query: searchQuerySchema }),
  asyncHandler(searchController.facets.bind(searchController))
);

/**
 * GET /search/autocomplete
 *
 * Typeahead suggestions for city/locality.
 * ?q=mumb&type=city  → ["mumbai", "mumbai suburbs", ...]
 * ?q=band&type=all   → cities + localities
 *
 * Aggressively cached (1 hour). Safe to call on every keystroke
 * when debounced to ~300ms on the client.
 */
router.get(
  '/autocomplete',
  validate({ query: autocompleteSchema }),
  asyncHandler(searchController.autocomplete.bind(searchController))
);

export default router;