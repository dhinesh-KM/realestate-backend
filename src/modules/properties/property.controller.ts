import { Request, Response } from 'express';
import { propertyService } from './property.service';
import { ApiResponse } from '../../shared/apiResponse';
import type { ListPropertiesQuery } from './property.validation';
import type { PropertyFilters, PaginationOptions, SortField, SortOrder } from './property.type';

export class PropertyController {

  async create(req: Request, res: Response) {
    const files    = (req.files ?? []) as Express.Multer.File[];
    const property = await propertyService.createProperty(req.user!.sub, req.body, files);
    return ApiResponse.created(res, { property }, 'Property listed successfully');
  }

  async list(req: Request, res: Response) {
    const q = req.query as unknown as ListPropertiesQuery;

    const filters: PropertyFilters = {
      city:         q.city         as string | undefined,
      locality:     q.locality     as string | undefined,
      listingType:  q.listingType  as any,
      propertyType: q.propertyType as any,
      priceMin:     q.priceMin     as any,
      priceMax:     q.priceMax     as any,
      bedrooms:     q.bedrooms     as any,
      areaMin:      q.areaMin      as any,
      areaMax:      q.areaMax      as any,
      isFurnished:  q.isFurnished  as any,
    };

    const pagination: PaginationOptions = {
      cursor:    q.cursor    as string | undefined,
      limit:     Number(q.limit    ?? 20),
      sortBy:    (q.sortBy    ?? 'createdAt') as SortField,
      sortOrder: (q.sortOrder ?? 'desc')      as SortOrder,
    };

    const { data, nextCursor, hasMore } = await propertyService.listProperties(filters, pagination);
    return ApiResponse.paginated(res, data, { nextCursor, hasMore }, 'Properties fetched');
  }

  async getMyListings(req: Request, res: Response) {
    const q = req.query as unknown as ListPropertiesQuery;

    const pagination: PaginationOptions = {
      cursor:    q.cursor    as string | undefined,
      limit:     Number(q.limit    ?? 20),
      sortBy:    (q.sortBy    ?? 'createdAt') as SortField,
      sortOrder: (q.sortOrder ?? 'desc')      as SortOrder,
    };

    const { data, nextCursor, hasMore } = await propertyService.getMyListings(req.user!.sub, pagination);
    return ApiResponse.paginated(res, data, { nextCursor, hasMore }, 'My listings fetched');
  }

  async getById(req: Request, res: Response) {
    // Run both queries in parallel — detail and similar are independent
    const [property, similarResult] = await Promise.all([
      propertyService.getPropertyById(req.params.id),
      propertyService.getSimilarProperties(req.params.id),
    ]);
    return ApiResponse.success(res, {
      property,
      similar: similarResult.properties,
      similarMeta: {
        algorithm:   similarResult.algorithm,
        totalScored: similarResult.totalScored,
      },
    });
  }

  async update(req: Request, res: Response) {
    const property = await propertyService.updateProperty(req.params.id, req.user!.sub, req.body);
    return ApiResponse.success(res, { property }, 'Property updated successfully');
  }

  async remove(req: Request, res: Response) {
    await propertyService.deleteProperty(req.params.id, req.user!.sub);
    return ApiResponse.success(res, null, 'Property removed successfully');
  }

  async addImages(req: Request, res: Response) {
    const files  = (req.files ?? []) as Express.Multer.File[];
    const images = await propertyService.addImages(req.params.id, req.user!.sub, files);
    return ApiResponse.created(res, { images }, 'Images uploaded successfully');
  }

  async deleteImage(req: Request, res: Response) {
    await propertyService.deletePropertyImage(req.params.id, req.params.imageId, req.user!.sub);
    return ApiResponse.success(res, null, 'Image deleted successfully');
  }

  async setPrimaryImage(req: Request, res: Response) {
    await propertyService.setPrimaryImage(req.params.id, req.params.imageId, req.user!.sub);
    return ApiResponse.success(res, null, 'Primary image updated');
  }

  async reorderImages(req: Request, res: Response) {
    await propertyService.reorderImages(req.params.id, req.user!.sub, req.body.images);
    return ApiResponse.success(res, null, 'Images reordered successfully');
  }

  async getSimilar(req: Request, res: Response) {
    const result = await propertyService.getSimilarProperties(req.params.id);
    return ApiResponse.success(res, {
      similar: result.properties,
      meta: {
        algorithm:   result.algorithm,
        totalScored: result.totalScored,
        count:       result.properties.length,
      },
    });
  }
}

export const propertyController = new PropertyController();