/**
 * Validation Middleware
 *
 * Express middleware for validating request data using Zod schemas.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, ZodIssue } from 'zod';

/**
 * Validation target - which part of the request to validate
 */
export type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Validation options for middleware
 */
export interface ValidationOptions {
  /** Whether to strip unknown keys (default: true) */
  stripUnknown?: boolean;
}

/**
 * Format Zod errors into a user-friendly message
 */
function formatZodError(error: ZodError<unknown>): string {
  return error.issues
    .map((e: ZodIssue) => {
      const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
      return `${path}${e.message}`;
    })
    .join('; ');
}

/**
 * Extended request type with validated data
 */
interface ValidatedRequest extends Request {
  validatedQuery?: unknown;
  validatedParams?: unknown;
}

/**
 * Creates a validation middleware for the specified request target
 *
 * @param schema - Zod schema to validate against
 * @param target - Which part of the request to validate (body, query, params)
 * @param options - Validation options
 * @returns Express middleware function
 *
 * @example
 * // Validate request body
 * router.post('/users', validate(CreateUserSchema, 'body'), createUser);
 *
 * @example
 * // Validate query parameters
 * router.get('/users', validate(UserFilterSchema, 'query'), listUsers);
 *
 * @example
 * // Validate route parameters
 * router.get('/users/:id', validate(UserIdParamSchema, 'params'), getUser);
 */
export function validate(
  schema: ZodSchema,
  target: ValidationTarget,
  options: ValidationOptions = {}
): (req: Request, res: Response, next: NextFunction) => void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stripUnknown = true } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Parse and validate the target data
      const data = req[target];
      const result = schema.safeParse(data);

      if (!result.success) {
        return res.status(400).json({
          error: 'Validation Error',
          message: formatZodError(result.error),
          details: result.error.issues.map((e: ZodIssue) => ({
            field: e.path.join('.'),
            message: e.message,
            code: e.code,
          })),
        });
      }

      // Replace the request data with the validated (and transformed) data
      // This ensures default values and transformations are applied
      if (target === 'body') {
        req.body = result.data;
      } else if (target === 'query') {
        // For query, we need to be careful not to break Express's query object
        (req as ValidatedRequest).validatedQuery = result.data;
      } else if (target === 'params') {
        // For params, attach validated version
        (req as ValidatedRequest).validatedParams = result.data;
      }

      next();
    } catch (error) {
      // Unexpected error during validation
      next(error);
    }
  };
}

/**
 * Convenience function to validate body
 */
export function validateBody(schema: ZodSchema, options?: ValidationOptions) {
  return validate(schema, 'body', options);
}

/**
 * Convenience function to validate query parameters
 */
export function validateQuery(schema: ZodSchema, options?: ValidationOptions) {
  return validate(schema, 'query', options);
}

/**
 * Convenience function to validate route parameters
 */
export function validateParams(schema: ZodSchema, options?: ValidationOptions) {
  return validate(schema, 'params', options);
}

/**
 * Combined validation for multiple targets
 *
 * @example
 * router.put('/users/:id',
 *   validateAll({
 *     params: UserIdParamSchema,
 *     body: UpdateUserSchema,
 *   }),
 *   updateUser
 * );
 */
export function validateAll(schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Array<{
      target: string;
      field: string;
      message: string;
      code: string;
    }> = [];

    // Validate each target
    for (const [target, schema] of Object.entries(schemas)) {
      if (!schema) continue;

      const data = req[target as keyof typeof schemas];
      const result = schema.safeParse(data);

      if (!result.success) {
        result.error.issues.forEach((e: ZodIssue) => {
          errors.push({
            target,
            field: e.path.join('.'),
            message: e.message,
            code: e.code,
          });
        });
      } else {
        // Apply validated data
        if (target === 'body') {
          req.body = result.data;
        } else if (target === 'query') {
          (req as ValidatedRequest).validatedQuery = result.data;
        } else if (target === 'params') {
          (req as ValidatedRequest).validatedParams = result.data;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: errors.map((e) => `${e.target}.${e.field}: ${e.message}`).join('; '),
        details: errors,
      });
    }

    next();
  };
}
