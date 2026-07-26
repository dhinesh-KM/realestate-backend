import { ListingType, PropertyType, PropertyStatus } from '../../shared/enums';

export { ListingType, PropertyType, PropertyStatus };

export interface CreatePropertyInput {
  title: string;
  description: string;
  listingType: ListingType;
  propertyType: PropertyType;
  price: number;
  city: string;
  locality: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number;
  isFurnished?: boolean;
  amenityIds?: string[];
}

export interface UpdatePropertyInput extends Partial<CreatePropertyInput> {
  status?: PropertyStatus;
}

export interface PropertyFilters {
  city?: string;
  locality?: string;
  listingType?: ListingType;
  propertyType?: PropertyType;
  priceMin?: number;
  priceMax?: number;
  bedrooms?: number | number[];
  areaMin?: number;
  areaMax?: number;
  isFurnished?: boolean;
  status?: PropertyStatus;
  ownerId?: string;
}

export type SortField   = 'price' | 'createdAt' | 'areaSqft' | 'viewCount';
export type SortOrder   = 'asc' | 'desc';

export interface PaginationOptions {
  cursor?: string;
  limit: number;
  sortBy: SortField;
  sortOrder: SortOrder;
}

export interface PropertyImageDto {
  id: string;
  url: string;
  isPrimary: boolean;
  displayOrder: number;
}

export interface PropertyOwnerDto {
  id: string;
  name: string;
  phone: string | null;
  email: string;
}

export interface PropertyListItem {
  id: string;
  title: string;
  listingType: ListingType;
  propertyType: PropertyType;
  status: PropertyStatus;
  price: string;
  city: string;
  locality: string;
  state: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: string;
  isFurnished: boolean;
  primaryImage: string | null;
  viewCount: number;
  createdAt: Date;
}

export interface PropertyDetail {
  id: string;
  title: string;
  description: string;
  listingType: ListingType;
  propertyType: PropertyType;
  status: PropertyStatus;
  price: string;
  city: string;
  locality: string;
  state: string;
  pincode: string;
  latitude: string | null;
  longitude: string | null;
  bedrooms: number;
  bathrooms: number;
  areaSqft: string;
  isFurnished: boolean;
  viewCount: number;
  images: PropertyImageDto[];
  owner: PropertyOwnerDto;
  createdAt: Date;
  updatedAt: Date;
}

export interface MyPropertyListItem extends PropertyListItem {
  status: PropertyStatus;
  isActive: boolean;
  updatedAt: Date;
  imageCount: number;
}

export interface UploadedImage {
  url: string;
  key: string;
  originalName: string;
}