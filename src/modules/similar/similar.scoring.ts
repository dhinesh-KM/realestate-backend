import { WEIGHTS, MIN_SCORE_THRESHOLD } from './similar.type';
import type { ReferenceProperty, ScoredCandidate } from './similar.type';
import type { PropertyListItem } from '../properties/property.type';

// ── Haversine distance (km) ───────────────────────────────────
// Pure math — computes great-circle distance between two lat/lng points.
// Used to add geo-proximity score when both properties have coordinates.

function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R    = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Individual signal scorers ─────────────────────────────────
// Each returns { points, reason } so the score is fully auditable.

function scoreLocation(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  let   points             = 0;

  if (candidate.locality === ref.locality) {
    points += WEIGHTS.SAME_LOCALITY;
    reasons.push('Same locality');
  } else if (candidate.city === ref.city) {
    points += WEIGHTS.SAME_CITY;
    reasons.push('Same city');
  }

  return { points, reasons };
}

function scoreGeo(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  if (
    ref.latitude  == null || ref.longitude  == null ||
    candidate.latitude  == null || candidate.longitude == null
  ) {
    return { points: 0, reasons: [] };
  }

  const km = haversineKm(
    ref.latitude,  ref.longitude,
    Number(candidate.latitude), Number(candidate.longitude)
  );

  if (km <= 2) return { points: WEIGHTS.GEO_WITHIN_2KM, reasons: [`Within ${km.toFixed(1)} km`] };
  if (km <= 5) return { points: WEIGHTS.GEO_WITHIN_5KM, reasons: [`Within ${km.toFixed(1)} km`] };
  return { points: 0, reasons: [] };
}

function scorePropertyType(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  if (candidate.propertyType === ref.propertyType) {
    return { points: WEIGHTS.SAME_PROPERTY_TYPE, reasons: [`Same type (${ref.propertyType})`] };
  }
  return { points: 0, reasons: [] };
}

function scoreBedrooms(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  const diff = Math.abs(candidate.bedrooms - ref.bedrooms);
  if (diff === 0) return { points: WEIGHTS.BEDROOMS_EXACT, reasons: [`${ref.bedrooms} BHK`] };
  if (diff === 1) return { points: WEIGHTS.BEDROOMS_NEAR,  reasons: [`${candidate.bedrooms} BHK (similar)`] };
  return { points: 0, reasons: [] };
}

function scorePrice(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  const candPrice = Number(candidate.price);
  const ratio     = Math.abs(candPrice - ref.price) / ref.price;

  if (ratio <= 0.10) return { points: WEIGHTS.PRICE_WITHIN_10, reasons: ['Price within 10%'] };
  if (ratio <= 0.20) return { points: WEIGHTS.PRICE_WITHIN_20, reasons: ['Price within 20%'] };
  return { points: 0, reasons: [] };
}

function scoreListingType(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  if (candidate.listingType === ref.listingType) {
    return { points: WEIGHTS.SAME_LISTING_TYPE, reasons: [] }; // not shown to user — expected
  }
  return { points: -50, reasons: [] }; // heavy penalty — rent vs sale is a hard boundary
}

function scoreArea(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  const candArea = Number(candidate.areaSqft);
  const ratio    = Math.abs(candArea - ref.areaSqft) / ref.areaSqft;
  if (ratio <= 0.20) return { points: WEIGHTS.AREA_WITHIN_20, reasons: [] };
  return { points: 0, reasons: [] };
}

function scoreFurnished(
  ref: ReferenceProperty,
  candidate: any
): { points: number; reasons: string[] } {
  if (candidate.isFurnished === ref.isFurnished) {
    return {
      points:  WEIGHTS.SAME_FURNISHED,
      reasons: ref.isFurnished ? ['Furnished'] : [],
    };
  }
  return { points: 0, reasons: [] };
}

// ── Main scoring function ─────────────────────────────────────

/**
 * scoreCandidate — computes similarity score for one candidate.
 *
 * Returns null if the score is below MIN_SCORE_THRESHOLD,
 * so the caller can filter in a single pass.
 *
 * Design: pure function with no I/O — can be unit tested
 * without any mocks. The SQL query in the service provides
 * pre-filtered candidates; this function re-scores them
 * with the geo signal (which can't be expressed cleanly in SQL
 * without PostGIS) and produces human-readable match reasons.
 */
export function scoreCandidate(
  ref: ReferenceProperty,
  candidate: any
): ScoredCandidate | null {
  const signals = [
    scoreLocation(ref, candidate),
    scoreGeo(ref, candidate),
    scorePropertyType(ref, candidate),
    scoreBedrooms(ref, candidate),
    scorePrice(ref, candidate),
    scoreListingType(ref, candidate),
    scoreArea(ref, candidate),
    scoreFurnished(ref, candidate),
  ];

  const totalPoints = signals.reduce((sum, s) => sum + s.points, 0);
  const allReasons  = signals.flatMap((s) => s.reasons);

  // Cap at 100
  const similarityScore = Math.min(100, Math.max(0, totalPoints));

  if (similarityScore < MIN_SCORE_THRESHOLD) return null;

  return {
    ...candidate,
    price:           candidate.price.toString(),
    areaSqft:        candidate.areaSqft.toString(),
    similarityScore,
    matchReasons:    allReasons,
  };
}

/**
 * rankCandidates — takes raw SQL rows, scores each one, filters
 * below-threshold results, and returns top N sorted by score.
 *
 * Separating ranking from fetching means:
 * 1. The SQL query stays simple (no complex scoring expressions)
 * 2. Geo scoring (haversine) runs in Node, not PostgreSQL
 * 3. The entire scoring logic is unit-testable without a DB
 */
export function rankCandidates(
  ref: ReferenceProperty,
  candidates: any[],
  limit: number
): ScoredCandidate[] {
  return candidates
    .map((c) => scoreCandidate(ref, c))
    .filter((c): c is ScoredCandidate => c !== null)
    .sort((a, b) => b.similarityScore - a.similarityScore || b.viewCount - a.viewCount)
    .slice(0, limit);
}