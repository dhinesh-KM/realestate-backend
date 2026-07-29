import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { uploadImages, deleteImage, deleteImages } from '../../lib/s3';
import { AppError } from '../../shared/apiError';
import { similarPropertyService } from '../similar/similar.service';
import { logger } from '../../shared/logger';
import { PropertyStatus } from '../../shared/enums';
import type {
  CreatePropertyInput,
  UpdatePropertyInput,
  PropertyFilters,
  PaginationOptions,
  PropertyListItem,
  PropertyDetail,
  MyPropertyListItem,
} from './property.type';

const CACHE_TTL = {
  PROPERTY_DETAIL: 60 * 5,
  SIMILAR:         60 * 30,
};

// ── Reusable select shapes ────────────────────────────────────

const LISTING_SELECT = {
  id: true, title: true, listingType: true, propertyType: true,
  status: true, price: true, city: true, locality: true, state: true,
  bedrooms: true, bathrooms: true, areaSqft: true, isFurnished: true,
  viewCount: true, createdAt: true,
  images: { where: { isPrimary: true }, select: { url: true }, take: 1 },
};

const DETAIL_SELECT = {
  id: true, title: true, description: true, listingType: true, propertyType: true,
  status: true, price: true, city: true, locality: true, state: true, pincode: true,
  latitude: true, longitude: true, bedrooms: true, bathrooms: true, areaSqft: true,
  isFurnished: true, viewCount: true, createdAt: true, updatedAt: true,
  images: {
    orderBy: { displayOrder: 'asc' as const },
    select:  { id: true, url: true, isPrimary: true, displayOrder: true },
  },
  owner: { select: { id: true, name: true, phone: true, email: true } },
};

// ── Service class ─────────────────────────────────────────────

export class PropertyService {

  // ── CREATE ──────────────────────────────────────────────────
  async createProperty(
    ownerId: string,
    input: CreatePropertyInput,
    files: Express.Multer.File[]
  ) {
    const activeCount = await prisma.property.count({
      where: { ownerId, isActive: true },
    });
    if (activeCount >= 50) {
      throw AppError.forbidden('You have reached the maximum of 50 active listings');
    }

    const uploadedImages = await uploadImages(files, `properties/${ownerId}`);

    try {
      const property = await prisma.$transaction(async (tx: any) => {
        const created = await tx.property.create({
          data: {
            ownerId,
            title:        input.title,
            description:  input.description,
            listingType:  input.listingType,
            propertyType: input.propertyType,
            price:        input.price,
            city:         input.city.toLowerCase().trim(),
            locality:     input.locality.toLowerCase().trim(),
            state:        input.state,
            pincode:      input.pincode,
            latitude:     input.latitude,
            longitude:    input.longitude,
            bedrooms:     input.bedrooms,
            bathrooms:    input.bathrooms,
            areaSqft:     input.areaSqft,
            isFurnished:  input.isFurnished ?? false,
          },
        });

        if (uploadedImages.length > 0) {
          await tx.propertyImage.createMany({
            data: uploadedImages.map((img: any, idx: number) => ({
              propertyId:   created.id,
              url:          img.url,
              key:          img.key,
              isPrimary:    idx === 0,
              displayOrder: idx,
            })),
          });
        }
        return created;
      });

      logger.info('Property created', { propertyId: property.id, ownerId });

      // Warm similar cache in background — first visitor to the detail page
      // gets a cache hit instead of a cold query
      similarPropertyService.warmUp(property.id).catch(() => {});

      return property;
    } catch (err) {
      if (uploadedImages.length > 0) {
        await deleteImages(uploadedImages.map((i: any) => i.key));
      }
      throw err;
    }
  }

  // ── LIST (public feed) ──────────────────────────────────────
  async listProperties(filters: PropertyFilters, pagination: PaginationOptions) {
    const { cursor, limit, sortBy, sortOrder } = pagination;

    const where: any = {
      isActive: true,
      status:   PropertyStatus.ACTIVE,
      ...(filters.city        && { city:         { contains: filters.city.toLowerCase(),     mode: 'insensitive' } }),
      ...(filters.locality    && { locality:     { contains: filters.locality.toLowerCase(), mode: 'insensitive' } }),
      ...(filters.listingType  && { listingType:  filters.listingType }),
      ...(filters.propertyType && { propertyType: filters.propertyType }),
      ...(filters.isFurnished !== undefined && { isFurnished: filters.isFurnished }),
      ...(filters.bedrooms && {
        bedrooms: Array.isArray(filters.bedrooms) ? { in: filters.bedrooms } : filters.bedrooms,
      }),
      ...((filters.priceMin || filters.priceMax) && {
        price: {
          ...(filters.priceMin && { gte: filters.priceMin }),
          ...(filters.priceMax && { lte: filters.priceMax }),
        },
      }),
      ...((filters.areaMin || filters.areaMax) && {
        areaSqft: {
          ...(filters.areaMin && { gte: filters.areaMin }),
          ...(filters.areaMax && { lte: filters.areaMax }),
        },
      }),
    };

    const take = limit + 1;

    // Cursor clause
    let finalWhere = where;
    if (cursor) {
      const cursorValue = await this._getCursorValue(cursor, sortBy);
      const op = sortOrder === 'desc' ? 'lt' : 'gt';
      finalWhere = {
        AND: [
          where,
          {
            OR: [
              { [sortBy]: { [op]: cursorValue } },
              { [sortBy]: cursorValue, id: { [op]: cursor } },
            ],
          },
        ],
      };
    }

    const properties = await prisma.property.findMany({
      where:   finalWhere,
      select:  LISTING_SELECT,
      orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
      take,
    });

    const hasMore    = properties.length > limit;
    const items      = hasMore ? properties.slice(0, limit) : properties;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const data: PropertyListItem[] = items.map((p: any) => ({
      ...p,
      price:        p.price.toString(),
      areaSqft:     p.areaSqft.toString(),
      primaryImage: p.images[0]?.url ?? null,
      images:       undefined,
    }));

    return { data, nextCursor, hasMore };
  }

  // ── GET DETAIL ──────────────────────────────────────────────
  async getPropertyById(id: string): Promise<PropertyDetail> {
    const redis    = getRedisClient();
    const cacheKey = `property:detail:${id}`;
    const cached   = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      this._incrementViewCount(id).catch(() => {});
      return JSON.parse(cached);
    }

    const property = await prisma.property.findUnique({
      where:  { id },
      // select: DETAIL_SELECT,
    }) as any;
    console.log("property",property.isActive, DETAIL_SELECT, id)
    if (!property)           throw AppError.notFound('Property not found');
    if (!property.isActive)  throw AppError.notFound('Property is no longer available');

    const detail: PropertyDetail = {
      ...property,
      price:     property.price.toString(),
      areaSqft:  property.areaSqft.toString(),
      latitude:  property.latitude?.toString()  ?? null,
      longitude: property.longitude?.toString() ?? null,
    };

    await redis.setEx(cacheKey, CACHE_TTL.PROPERTY_DETAIL, JSON.stringify(detail)).catch(() => {});
    this._incrementViewCount(id).catch(() => {});
    return detail;
  }

  // ── MY LISTINGS ─────────────────────────────────────────────
  async getMyListings(ownerId: string, pagination: PaginationOptions) {
    const { limit, sortBy, sortOrder, cursor } = pagination;
    const take = limit + 1;

    const where: any = { ownerId };
    let finalWhere   = where;
    if (cursor) {
      finalWhere = { AND: [where, { id: { [sortOrder === 'desc' ? 'lt' : 'gt']: cursor } }] };
    }

    const properties = await prisma.property.findMany({
      where:   finalWhere,
      orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
      take,
      select: {
        ...LISTING_SELECT,
        status: true, isActive: true, updatedAt: true,
        _count: { select: { images: true } },
      },
    });

    const hasMore    = properties.length > limit;
    const items      = hasMore ? properties.slice(0, limit) : properties;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const data: MyPropertyListItem[] = items.map((p: any) => ({
      ...p,
      price:        p.price.toString(),
      areaSqft:     p.areaSqft.toString(),
      primaryImage: p.images[0]?.url ?? null,
      imageCount:   p._count.images,
      images:       undefined,
      _count:       undefined,
    }));

    return { data, nextCursor, hasMore };
  }

  // ── UPDATE ──────────────────────────────────────────────────
  async updateProperty(propertyId: string, ownerId: string, input: UpdatePropertyInput) {
    await this._assertOwnership(propertyId, ownerId);

    const updated = await prisma.property.update({
      where: { id: propertyId },
      data:  {
        ...input,
        ...(input.city     && { city:     input.city.toLowerCase().trim() }),
        ...(input.locality && { locality: input.locality.toLowerCase().trim() }),
      },
    });

    await this._invalidatePropertyCache(propertyId);
    logger.info('Property updated', { propertyId, ownerId });
    return updated;
  }

  // ── DELETE (soft) ────────────────────────────────────────────
  async deleteProperty(propertyId: string, ownerId: string) {
    await this._assertOwnership(propertyId, ownerId);
    await prisma.property.update({
      where: { id: propertyId },
      data:  { isActive: false, status: PropertyStatus.INACTIVE },
    });
    await this._invalidatePropertyCache(propertyId);
    logger.info('Property soft-deleted', { propertyId, ownerId });
  }

  // ── ADD IMAGES ──────────────────────────────────────────────
  async addImages(propertyId: string, ownerId: string, files: Express.Multer.File[]) {
    await this._assertOwnership(propertyId, ownerId);
    if (files.length === 0) throw AppError.badRequest('No image files provided');

    const currentCount = await prisma.propertyImage.count({ where: { propertyId } });
    if (currentCount + files.length > 10) {
      throw AppError.badRequest(
        `Cannot add ${files.length} images. Max 10 per property (currently ${currentCount})`
      );
    }

    const uploaded = await uploadImages(files, `properties/${ownerId}`);
    try {
      await prisma.propertyImage.createMany({
        data: uploaded.map((img: any, idx: number) => ({
          propertyId,
          url:          img.url,
          key:          img.key,
          isPrimary:    currentCount === 0 && idx === 0,
          displayOrder: currentCount + idx,
        })),
      });
    } catch (err) {
      await deleteImages(uploaded.map((i: any) => i.key));
      throw err;
    }

    await this._invalidatePropertyCache(propertyId);
    return prisma.propertyImage.findMany({
      where:   { propertyId },
      orderBy: { displayOrder: 'asc' },
      select:  { id: true, url: true, isPrimary: true, displayOrder: true },
    });
  }

  // ── DELETE IMAGE ─────────────────────────────────────────────
  async deletePropertyImage(propertyId: string, imageId: string, ownerId: string) {
    await this._assertOwnership(propertyId, ownerId);
    const image = await prisma.propertyImage.findFirst({ where: { id: imageId, propertyId } });
    if (!image) throw AppError.notFound('Image not found');

    await prisma.$transaction(async (tx: any) => {
      await tx.propertyImage.delete({ where: { id: imageId } });
      if (image.isPrimary) {
        const next = await tx.propertyImage.findFirst({
          where: { propertyId }, orderBy: { displayOrder: 'asc' },
        });
        if (next) await tx.propertyImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });

    deleteImage(image.key).catch(() => {});
    await this._invalidatePropertyCache(propertyId);
  }

  // ── SET PRIMARY IMAGE ────────────────────────────────────────
  async setPrimaryImage(propertyId: string, imageId: string, ownerId: string) {
    await this._assertOwnership(propertyId, ownerId);
    const image = await prisma.propertyImage.findFirst({ where: { id: imageId, propertyId } });
    if (!image) throw AppError.notFound('Image not found on this property');

    await prisma.$transaction([
      prisma.propertyImage.updateMany({ where: { propertyId }, data: { isPrimary: false } }),
      prisma.propertyImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
    await this._invalidatePropertyCache(propertyId);
  }

  // ── REORDER IMAGES ───────────────────────────────────────────
  async reorderImages(
    propertyId: string, ownerId: string,
    reorderData: { id: string; displayOrder: number }[]
  ) {
    await this._assertOwnership(propertyId, ownerId);
    await prisma.$transaction(
      reorderData.map(({ id, displayOrder }) =>
        prisma.propertyImage.update({ where: { id, propertyId }, data: { displayOrder } })
      )
    );
    await this._invalidatePropertyCache(propertyId);
  }

  // ── SIMILAR PROPERTIES — delegated to SimilarPropertyService ─
  async getSimilarProperties(propertyId: string) {
    return similarPropertyService.getSimilarProperties(propertyId);
  }

  // ── PRIVATE HELPERS ──────────────────────────────────────────

  private async _assertOwnership(propertyId: string, ownerId: string) {
    const property = await prisma.property.findUnique({
      where:  { id: propertyId },
      select: { ownerId: true, isActive: true },
    });
    if (!property)                    throw AppError.notFound('Property not found');
    if (property.ownerId !== ownerId) throw AppError.forbidden('You do not have permission to modify this property');
  }

  private async _incrementViewCount(propertyId: string) {
    await prisma.property.update({
      where: { id: propertyId },
      data:  { viewCount: { increment: 1 } },
    });
  }

  private async _invalidatePropertyCache(propertyId: string) {
    const redis = getRedisClient();
    await Promise.allSettled([
      redis.del(`property:detail:${propertyId}`),
      // Delegate similar cache invalidation to its own service
      similarPropertyService.invalidate(propertyId),
    ]);
  }

  private async _getCursorValue(cursor: string, sortBy: string): Promise<any> {
    const property = await prisma.property.findUnique({
      where:  { id: cursor },
      select: { [sortBy]: true },
    }) as any;
    return property?.[sortBy];
  }
}

export const propertyService = new PropertyService();