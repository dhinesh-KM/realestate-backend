import { z } from 'zod';
import { ListingType, PropertyType, PropertyStatus } from '../../shared/enums';

const priceSchema = z
  .number({ required_error: 'Price is required' })
  .positive('Price must be a positive number')
  .max(999_999_999, 'Price is unrealistically high');

const bedroomsSchema = z
  .number()
  .int('Bedrooms must be a whole number')
  .min(0, 'Bedrooms cannot be negative')
  .max(20, 'Bedrooms cannot exceed 20');

const bathroomsSchema = z
  .number()
  .int('Bathrooms must be a whole number')
  .min(1, 'At least 1 bathroom required')
  .max(20, 'Bathrooms cannot exceed 20');

const areaSchema = z
  .number({ required_error: 'Area is required' })
  .positive('Area must be positive')
  .max(100_000, 'Area seems unrealistically large');

export const createPropertySchema = z.object({
  title: z.string({ required_error: 'Title is required' }).trim()
    .min(10, 'Title must be at least 10 characters')
    .max(150, 'Title must be at most 150 characters'),

  description: z.string({ required_error: 'Description is required' }).trim()
    .min(50, 'Description must be at least 50 characters')
    .max(5000, 'Description must be at most 5000 characters'),

  listingType: z.enum(Object.values(ListingType) as [string, ...string[]], {
    errorMap: () => ({ message: `Listing type must be one of: ${Object.values(ListingType).join(', ')}` }),
  }) as z.ZodEnum<[ListingType, ...ListingType[]]>,

  propertyType: z.enum(Object.values(PropertyType) as [string, ...string[]], {
    errorMap: () => ({ message: `Property type must be one of: ${Object.values(PropertyType).join(', ')}` }),
  }) as z.ZodEnum<[PropertyType, ...PropertyType[]]>,

  price: priceSchema,

  city: z.string({ required_error: 'City is required' }).trim()
    .min(2, 'City name is too short').max(100, 'City name is too long'),

  locality: z.string({ required_error: 'Locality is required' }).trim()
    .min(2, 'Locality name is too short').max(150, 'Locality name is too long'),

  state: z.string({ required_error: 'State is required' }).trim()
    .min(2, 'State name is too short').max(100, 'State name is too long'),

  pincode: z.string({ required_error: 'Pincode is required' }).trim()
    .regex(/^\d{6}$/, 'Pincode must be a 6-digit number'),

  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),

  bedrooms:  bedroomsSchema,
  bathrooms: bathroomsSchema,
  areaSqft:  areaSchema,

  isFurnished: z.boolean().default(false),

  amenityIds: z.array(z.string().uuid('Each amenity ID must be a valid UUID'))
    .max(20, 'Cannot attach more than 20 amenities').optional().default([]),
});

export const updatePropertySchema = createPropertySchema
  .partial()
  .extend({
    status: z.enum(Object.values(PropertyStatus) as [string, ...string[]]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const listPropertiesSchema = z.object({
  city:         z.string().trim().optional(),
  locality:     z.string().trim().optional(),
  listingType:  z.enum(Object.values(ListingType) as [string, ...string[]]).optional(),
  propertyType: z.enum(Object.values(PropertyType) as [string, ...string[]]).optional(),
  priceMin:     z.string().transform(Number).pipe(z.number().positive()).optional(),
  priceMax:     z.string().transform(Number).pipe(z.number().positive()).optional(),
  bedrooms:     z.string().transform(v => v.split(',').map(n => parseInt(n.trim(), 10))).optional(),
  areaMin:      z.string().transform(Number).pipe(z.number().positive()).optional(),
  areaMax:      z.string().transform(Number).pipe(z.number().positive()).optional(),
  isFurnished:  z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  cursor:       z.string().uuid('Invalid cursor').optional(),
  limit:        z.string().transform(Number).pipe(z.number().int().min(1).max(50)).default('20'),
  sortBy:       z.enum(['price', 'createdAt', 'areaSqft', 'viewCount']).default('createdAt'),
  sortOrder:    z.enum(['asc', 'desc']).default('desc'),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid property ID'),
});

export const reorderImagesSchema = z.object({
  images: z.array(z.object({
    id:           z.string().uuid(),
    displayOrder: z.number().int().min(0),
  })).min(1, 'At least one image required'),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
export type ListPropertiesQuery = z.infer<typeof listPropertiesSchema>;