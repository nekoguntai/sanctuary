import type { ZodIssue, ZodType } from 'zod';
import { ValidationError } from '../../errors/ApiError';

function formatIssue(issue: ZodIssue): { path: string; message: string } {
  return {
    path: issue.path.join('.'),
    message: issue.message,
  };
}

function formatMessage(issue: { path: string; message: string }): string {
  return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
}

/**
 * Parse a transaction request body with a shared Zod schema and map failures to the API error shape.
 */
export function parseTransactionRequestBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map(formatIssue);
  throw new ValidationError(
    issues.map(formatMessage).join(', '),
    undefined,
    { issues }
  );
}
