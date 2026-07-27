import type { PropertyListItem } from '../properties/property.types';

// ── Reference property (fetched once, used by all scoring passes) ─

export interface ReferenceProperty {
  id:           string;
  city:         string;
  locality:     string;
  state:        string;
  propertyType: string;
  listingType:  string;
  bedrooms:     number;
  bathrooms:    number;
  price:        number;
  areaSqft:     number;
  isFurnished:  boolean;
  latitude:     number | null;
  longitude:    number | null;
}

// ── Scored candidate returned by SQL ─────────────────────────

export interface ScoredCandidate extends PropertyListItem {
  similarityScore: number;
  matchReasons:    string[];    // e.g. ["Same locality", "Price within 20%"]
}

// ── Final response shape ──────────────────────────────────────

export interface SimilarPropertiesResult {
  properties:  ScoredCandidate[];
  algorithm:   'weighted_score' | 'fallback_city' | 'fallback_type';
  // Algorithm used — useful for debugging and A/B testing
  totalScored: number;          // how many candidates were evaluated
}

// ── Scoring weights — defined once, tunable ───────────────────
//
// These constants are the "algorithm" decision.
// Weights are normalised so a perfect match scores 100.
// Ordered by how much the signal matters to a real buyer.

export const WEIGHTS = {
  SAME_LOCALITY:     25,   // same street / micro-location
  SAME_CITY:         20,   // same city — location is #1 criterion
  SAME_PROPERTY_TYPE: 18,  // apartment vs villa is a hard preference
  BEDROOMS_EXACT:    12,   // exact bedroom count match
  BEDROOMS_NEAR:      7,   // ±1 bedroom (a 3BHK might consider 2BHK)
  PRICE_WITHIN_10:   10,   // within 10% — tight budget match
  PRICE_WITHIN_20:    6,   // within 20% — slightly flexible
  SAME_LISTING_TYPE:  5,   // rent vs sale intent is distinct
  AREA_WITHIN_20:     4,   // area is secondary to location/price
  SAME_FURNISHED:     3,   // furnishing preference
  GEO_WITHIN_2KM:     8,   // proximity bonus (if lat/lng available)
  GEO_WITHIN_5KM:     4,   // broader proximity
  // Max possible = 25+20+18+12+10+5+4+3+8 = 105, capped at 100
} as const;

// Minimum score to include a property in results.
// Below this, similarity is too weak to be useful.
export const MIN_SCORE_THRESHOLD = 20;

// How many similar properties to return
export const SIMILAR_COUNT = 6;