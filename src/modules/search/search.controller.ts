import { Request, Response } from 'express';
import { searchService } from './search.service';
import { ApiResponse } from '../../shared/apiResponse';
import type { SearchQueryInput, AutocompleteInput } from './search.validation';
import type { SearchQuery } from './search.type';

export class SearchController {

  /**
   * GET /search
   * Main search endpoint — full-text + filters + cursor pagination + facets.
   */
  async search(req: Request, res: Response) {
    const q = req.query as unknown as SearchQueryInput;

    const searchQuery: SearchQuery = {
      q:            q.q,
      city:         q.city,
      locality:     q.locality,
      state:        q.state,
      listingType:  q.listingType  as any,
      propertyType: q.propertyType as any,
      bedrooms:     q.bedrooms     as any,
      bathrooms:    q.bathrooms    as any,
      isFurnished:  q.isFurnished  as any,
      priceMin:     q.priceMin     as any,
      priceMax:     q.priceMax     as any,
      areaMin:      q.areaMin      as any,
      areaMax:      q.areaMax      as any,
      cursor:       q.cursor,
      limit:        Number(q.limit ?? 20),
      sortBy:       (q.sortBy   ?? 'createdAt') as any,
      sortOrder:    (q.sortOrder ?? 'desc')      as any,
    };

    const result = await searchService.search(searchQuery);

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Search results',
      data: result.data,
      pagination: result.pagination,
      meta: result.meta,
    });
  }

  /**
   * GET /search/facets
   * Filter counts for the search sidebar.
   * Called separately — allows the main results to render before facets load.
   */
  async facets(req: Request, res: Response) {
    const q = req.query as unknown as SearchQueryInput;

    const searchQuery: SearchQuery = {
      q:            q.q,
      city:         q.city,
      locality:     q.locality,
      state:        q.state,
      listingType:  q.listingType  as any,
      propertyType: q.propertyType as any,
      bedrooms:     q.bedrooms     as any,
      priceMin:     q.priceMin     as any,
      priceMax:     q.priceMax     as any,
      isFurnished:  q.isFurnished  as any,
      limit: 0,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };

    const facets = await searchService.getFacets(searchQuery);
    return ApiResponse.success(res, { facets });
  }

  /**
   * GET /search/autocomplete
   * City/locality suggestions for the search box.
   */
  async autocomplete(req: Request, res: Response) {
    const { q, type } = req.query as unknown as AutocompleteInput;
    const results     = await searchService.autocomplete(q, type as any ?? 'all');
    return ApiResponse.success(res, results);
  }
}

export const searchController = new SearchController();