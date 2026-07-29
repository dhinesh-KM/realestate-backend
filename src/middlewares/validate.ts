import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ValidateSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Validate middleware — runs Zod schemas against req.body / req.query / req.params.
 * On failure → 400 with structured field-level errors (never a stack trace).
 * On success  → parsed + coerced data replaces raw input, so controllers
 *               receive clean, typed data without any manual parsing.
 */
export const validate = (schemas: ValidateSchemas) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      // if (schemas.query) {
      //   req.query = schemas.query.parse(req.query) as any;
      // }
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        // Safely mutate req.query properties without overwriting the object getter
        Object.keys(req.query).forEach(key => delete (req.query as any)[key]);
        Object.assign(req.query, parsedQuery);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as any;
      }
      next();
    } catch (err) {
      
      if (err instanceof ZodError) {
        console.log("error---",err.issues)
        const rawIssues = (err as any).issues || (err as any).errors || JSON.parse(err.message);

        const errors = rawIssues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));


        return res.status(400).json({
          success: false,
          statusCode: 400,
          message: 'Validation failed',
          errors,
        });
      }
      next(err);
    }
  };
};