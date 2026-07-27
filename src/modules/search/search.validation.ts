import { z } from 'zod';
import { ListingType, PropertyType } from '../../shared/enums';

// ── Helper: parse comma-separated integers ────────────────────
const commaInts = z
  .string()
  .transform((val) => {
    const nums = val.split(',').map((v) => parseInt(v.trim(), 10));
    if (nums.some(isNaN)) throw new Error('Invalid integer list');
    return nums;
  });

// ── Helper: parse numeric string ─────────────────────────────
const numStr = (label: string) =>
  z
    .string()
    .transform((v) => {
      const n = Number(v);
      if (isNaN(n) || n < 0) throw new Error(`${label} must be a positive number`);
      return n;
    });

// ── Main search query schema ──────────────────────────────────

export const searchQuerySchema = z.object({
  // Full-text search keyword
  q: z
    .string()
    .trim()
    .min(1)
    .max(200, 'Search query too long')
    .optional(),

  // Location
  city:     z.string().trim().min(1).max(100).optional(),
  locality: z.string().trim().min(1).max(150).optional(),
  state:    z.string().trim().min(1).max(100).optional(),

  // Listing / property type
  listingType: z
    .enum(Object.values(ListingType) as [string, ...string[]])
    .optional(),

  propertyType: z
    .enum(Object.values(PropertyType) as [string, ...string[]])
    .optional(),

  // Bedrooms — supports multi-select: ?bedrooms=2,3
  bedrooms: commaInts.optional(),

  // Bathrooms
  bathrooms: numStr('bathrooms')
    .pipe(z.number().int().min(1).max(20))
    .optional(),

  // Furnished
  isFurnished: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),

  // Price range
  priceMin: numStr('priceMin').pipe(z.number().min(0)).optional(),
  priceMax: numStr('priceMax').pipe(z.number().min(0)).optional(),

  // Area range
  areaMin: numStr('areaMin').pipe(z.number().min(0)).optional(),
  areaMax: numStr('areaMax').pipe(z.number().min(0)).optional(),

  // Cursor (opaque base64 string from previous response)
  cursor: z.string().optional(),

  // Limit — max 50 items per page
  limit: z
    .string()
    .default('20')
    .transform(Number)
    .pipe(z.number().int().min(1).max(50)),

  // Sort
  sortBy: z
    .enum(['relevance', 'price', 'createdAt', 'areaSqft', 'viewCount'])
    .default('createdAt'),

  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})
// Cross-field validation
.refine(
  (d) => !d.priceMin || !d.priceMax || d.priceMin <= d.priceMax,
  { message: 'priceMin must be less than or equal to priceMax', path: ['priceMin'] }
)
.refine(
  (d) => !d.areaMin || !d.areaMax || d.areaMin <= d.areaMax,
  { message: 'areaMin must be less than or equal to areaMax', path: ['areaMin'] }
)
.refine(
  (d) => d.sortBy !== 'relevance' || !!d.q,
  { message: 'sortBy=relevance requires a search query (q)', path: ['sortBy'] }
);

// ── Autocomplete schema ───────────────────────────────────────

export const autocompleteSchema = z.object({
  q: z
    .string({ required_error: 'Query is required' })
    .trim()
    .min(2, 'At least 2 characters required for autocomplete')
    .max(100),

  type: z.enum(['city', 'locality', 'all']).default('all'),
});

export type SearchQueryInput  = z.infer<typeof searchQuerySchema>;
export type AutocompleteInput = z.infer<typeof autocompleteSchema>;