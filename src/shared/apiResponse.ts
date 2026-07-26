import { Response } from 'express';

interface Meta {
  page?: number;
  limit?: number;
  total?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export class ApiResponse {
  static success<T>(
    res: Response,
    data: T,
    message = 'Success',
    statusCode = 200,
    meta?: Meta
  ) {
    return res.status(statusCode).json({
      success: true,
      statusCode,
      message,
      data,
      ...(meta && { meta }),
    });
  }

  static created<T>(res: Response, data: T, message = 'Created successfully') {
    return ApiResponse.success(res, data, message, 201);
  }

  static noContent(res: Response) {
    return res.status(204).send();
  }

  static paginated<T>(
    res: Response,
    data: T[],
    meta: Meta,
    message = 'Success'
  ) {
    return ApiResponse.success(res, data, message, 200, meta);
  }
}