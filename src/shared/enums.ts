// Enum constants — mirrors prisma schema exactly.
// Defined here so they're available before DB migration and Prisma generation.

export const ListingType = {
  RENT: 'RENT',
  SALE: 'SALE',
} as const;
export type ListingType = typeof ListingType[keyof typeof ListingType];

export const PropertyType = {
  APARTMENT:         'APARTMENT',
  VILLA:             'VILLA',
  INDEPENDENT_HOUSE: 'INDEPENDENT_HOUSE',
  PLOT:              'PLOT',
  COMMERCIAL:        'COMMERCIAL',
  PG:                'PG',
} as const;
export type PropertyType = typeof PropertyType[keyof typeof PropertyType];

export const PropertyStatus = {
  ACTIVE:   'ACTIVE',
  INACTIVE: 'INACTIVE',
  SOLD:     'SOLD',
  RENTED:   'RENTED',
} as const;
export type PropertyStatus = typeof PropertyStatus[keyof typeof PropertyStatus];

export const UserRole = {
  USER:  'USER',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = typeof UserRole[keyof typeof UserRole];