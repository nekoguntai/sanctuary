import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../../../src/errors/ApiError';
import { parseTransactionRequestBody } from '../../../src/api/transactions/requestValidation';

function captureValidationError(run: () => unknown): ValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }

  throw new Error('Expected ValidationError to be thrown');
}

describe('parseTransactionRequestBody', () => {
  it('returns parsed data on success', () => {
    const schema = z.object({
      amount: z.number(),
      label: z.string().optional(),
    });

    expect(parseTransactionRequestBody(schema, { amount: 42, label: 'rent' })).toEqual({
      amount: 42,
      label: 'rent',
    });
  });

  it('throws a ValidationError with joined field-level issues', () => {
    const schema = z.object({
      recipient: z.string({ message: 'recipient is required' }),
      amount: z.number({ message: 'amount is required' }),
    });

    const error = captureValidationError(() => parseTransactionRequestBody(schema, {}));

    expect(error.message).toBe('recipient: recipient is required, amount: amount is required');
    expect(error.details).toEqual({
      issues: [
        { path: 'recipient', message: 'recipient is required' },
        { path: 'amount', message: 'amount is required' },
      ],
    });
  });

  it('includes nested paths in formatted issue messages', () => {
    const schema = z.object({
      recipients: z.array(z.object({
        address: z.string({ message: 'address is required' }),
        amount: z.number(),
      })),
    });

    const error = captureValidationError(() =>
      parseTransactionRequestBody(schema, { recipients: [{ amount: 1 }] })
    );

    expect(error.message).toContain('recipients.0.address: address is required');
    expect(error.details).toEqual({
      issues: [{ path: 'recipients.0.address', message: 'address is required' }],
    });
  });

  it('formats root-level refinement issues without an empty path prefix', () => {
    const schema = z.object({
      signedPsbtBase64: z.string().optional(),
      rawTxHex: z.string().optional(),
    }).refine(
      (request) => Boolean(request.signedPsbtBase64 || request.rawTxHex),
      'Either signedPsbtBase64 or rawTxHex is required'
    );

    const error = captureValidationError(() => parseTransactionRequestBody(schema, {}));

    expect(error.message).toBe('Either signedPsbtBase64 or rawTxHex is required');
    expect(error.details).toEqual({
      issues: [{ path: '', message: 'Either signedPsbtBase64 or rawTxHex is required' }],
    });
  });
});
