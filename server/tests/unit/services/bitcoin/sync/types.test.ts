import { describe, expect, it } from 'vitest';
import { SyncPipelineError } from '../../../../../src/services/bitcoin/sync/types';

describe('SyncPipelineError', () => {
  it('preserves cause, phase data, and formatted message', () => {
    const cause = new Error('phase exploded');
    const error = new SyncPipelineError(
      cause,
      ['discover-addresses', 'fetch-history'],
      'persist-transactions',
      { walletId: 'wallet-1' } as any
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SyncPipelineError');
    expect(error.message).toContain('persist-transactions');
    expect(error.message).toContain('phase exploded');
    expect(error.cause).toBe(cause);
    expect(error.completedPhases).toEqual(['discover-addresses', 'fetch-history']);
    expect(error.failedPhase).toBe('persist-transactions');
    expect(error.context).toMatchObject({ walletId: 'wallet-1' });
  });
});
