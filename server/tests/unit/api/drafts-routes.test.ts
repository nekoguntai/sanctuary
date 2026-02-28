import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockGetDraftsForWallet,
  mockGetDraft,
  mockCreateDraft,
  mockUpdateDraft,
  mockDeleteDraft,
  mockSerializeDraftTransaction,
  mockSerializeDraftTransactions,
} = vi.hoisted(() => ({
  mockGetDraftsForWallet: vi.fn(),
  mockGetDraft: vi.fn(),
  mockCreateDraft: vi.fn(),
  mockUpdateDraft: vi.fn(),
  mockDeleteDraft: vi.fn(),
  mockSerializeDraftTransaction: vi.fn(),
  mockSerializeDraftTransactions: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
    next();
  },
}));

vi.mock('../../../src/services/draftService', () => ({
  draftService: {
    getDraftsForWallet: mockGetDraftsForWallet,
    getDraft: mockGetDraft,
    createDraft: mockCreateDraft,
    updateDraft: mockUpdateDraft,
    deleteDraft: mockDeleteDraft,
  },
}));

vi.mock('../../../src/utils/serialization', () => ({
  serializeDraftTransaction: mockSerializeDraftTransaction,
  serializeDraftTransactions: mockSerializeDraftTransactions,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import draftsRouter from '../../../src/api/drafts';
import { ApiError, ErrorCodes } from '../../../src/errors';

describe('Draft Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', draftsRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockSerializeDraftTransaction.mockImplementation((draft: any) => ({
      id: draft.id,
      serialized: true,
    }));
    mockSerializeDraftTransactions.mockImplementation((drafts: any[]) =>
      drafts.map((draft) => ({ id: draft.id, serialized: true }))
    );

    mockGetDraftsForWallet.mockResolvedValue([{ id: 'draft-1' }, { id: 'draft-2' }]);
    mockGetDraft.mockResolvedValue({ id: 'draft-1' });
    mockCreateDraft.mockResolvedValue({ id: 'draft-created' });
    mockUpdateDraft.mockResolvedValue({ id: 'draft-updated' });
    mockDeleteDraft.mockResolvedValue(undefined);
  });

  it('lists drafts for a wallet', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/drafts');

    expect(response.status).toBe(200);
    expect(mockGetDraftsForWallet).toHaveBeenCalledWith('wallet-1', 'user-1');
    expect(mockSerializeDraftTransactions).toHaveBeenCalledWith([{ id: 'draft-1' }, { id: 'draft-2' }]);
    expect(response.body).toEqual([
      { id: 'draft-1', serialized: true },
      { id: 'draft-2', serialized: true },
    ]);
  });

  it('returns ApiError responses when listing drafts fails with known error', async () => {
    mockGetDraftsForWallet.mockRejectedValue(
      new ApiError('Forbidden to view drafts', 403, ErrorCodes.FORBIDDEN)
    );

    const response = await request(app).get('/api/v1/wallets/wallet-1/drafts');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: ErrorCodes.FORBIDDEN,
      message: 'Forbidden to view drafts',
    });
  });

  it('returns 500 when listing drafts fails unexpectedly', async () => {
    mockGetDraftsForWallet.mockRejectedValue(new Error('db unavailable'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/drafts');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'Failed to fetch drafts',
    });
  });

  it('gets a specific draft by id', async () => {
    const response = await request(app).get('/api/v1/wallets/wallet-1/drafts/draft-1');

    expect(response.status).toBe(200);
    expect(mockGetDraft).toHaveBeenCalledWith('wallet-1', 'draft-1', 'user-1');
    expect(mockSerializeDraftTransaction).toHaveBeenCalledWith({ id: 'draft-1' });
    expect(response.body).toEqual({ id: 'draft-1', serialized: true });
  });

  it('returns ApiError responses for get draft', async () => {
    mockGetDraft.mockRejectedValue(
      new ApiError('Draft not found', 404, ErrorCodes.NOT_FOUND)
    );

    const response = await request(app).get('/api/v1/wallets/wallet-1/drafts/missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: ErrorCodes.NOT_FOUND,
      message: 'Draft not found',
    });
  });

  it('returns 500 for unexpected get draft failures', async () => {
    mockGetDraft.mockRejectedValue(new Error('query failed'));

    const response = await request(app).get('/api/v1/wallets/wallet-1/drafts/draft-1');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to fetch draft');
  });

  it('creates a draft with full payload mapping', async () => {
    const payload = {
      recipient: 'tb1qrecipient',
      amount: 10000,
      feeRate: 5,
      selectedUtxoIds: ['u1', 'u2'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      outputs: [{ address: 'tb1qout', amount: 10000 }],
      inputs: [{ txid: 'a'.repeat(64), vout: 0 }],
      decoyOutputs: [{ address: 'tb1qdecoy', amount: 1200 }],
      payjoinUrl: 'https://example.com/pj',
      isRBF: false,
      label: 'Rent',
      memo: 'March rent',
      psbtBase64: 'cHNi',
      fee: 210,
      totalInput: 10210,
      totalOutput: 10000,
      changeAmount: 0,
      changeAddress: 'tb1qchange',
      effectiveAmount: 10000,
      inputPaths: { '0': "m/84'/1'/0'/0/0" },
    };

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/drafts')
      .send(payload);

    expect(response.status).toBe(201);
    expect(mockCreateDraft).toHaveBeenCalledWith('wallet-1', 'user-1', payload);
    expect(response.body).toEqual({ id: 'draft-created', serialized: true });
  });

  it('returns ApiError responses for create draft', async () => {
    mockCreateDraft.mockRejectedValue(
      new ApiError('Viewers cannot create draft transactions', 403, ErrorCodes.FORBIDDEN)
    );

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/drafts')
      .send({ recipient: 'tb1q', amount: 1 });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: ErrorCodes.FORBIDDEN,
      message: 'Viewers cannot create draft transactions',
    });
  });

  it('returns 500 for unexpected create draft failures', async () => {
    mockCreateDraft.mockRejectedValue(new Error('insert failed'));

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/drafts')
      .send({ recipient: 'tb1q', amount: 1 });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to create draft');
  });

  it('updates a draft', async () => {
    const patch = {
      signedPsbtBase64: 'signed-psbt',
      signedDeviceId: 'device-1',
      status: 'partially_signed',
      label: 'Updated label',
      memo: 'Updated memo',
    };

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/drafts/draft-1')
      .send(patch);

    expect(response.status).toBe(200);
    expect(mockUpdateDraft).toHaveBeenCalledWith('wallet-1', 'draft-1', 'user-1', patch);
    expect(response.body).toEqual({ id: 'draft-updated', serialized: true });
  });

  it('returns ApiError responses for update draft', async () => {
    mockUpdateDraft.mockRejectedValue(
      new ApiError('Draft not found', 404, ErrorCodes.NOT_FOUND)
    );

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/drafts/missing')
      .send({ label: 'x' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: ErrorCodes.NOT_FOUND,
      message: 'Draft not found',
    });
  });

  it('returns 500 for unexpected update failures', async () => {
    mockUpdateDraft.mockRejectedValue(new Error('update failed'));

    const response = await request(app)
      .patch('/api/v1/wallets/wallet-1/drafts/draft-1')
      .send({ memo: 'x' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to update draft');
  });

  it('deletes a draft and returns 204', async () => {
    const response = await request(app)
      .delete('/api/v1/wallets/wallet-1/drafts/draft-1');

    expect(response.status).toBe(204);
    expect(mockDeleteDraft).toHaveBeenCalledWith('wallet-1', 'draft-1', 'user-1');
  });

  it('returns ApiError responses for delete draft', async () => {
    mockDeleteDraft.mockRejectedValue(
      new ApiError('Draft not found', 404, ErrorCodes.NOT_FOUND)
    );

    const response = await request(app)
      .delete('/api/v1/wallets/wallet-1/drafts/missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: ErrorCodes.NOT_FOUND,
      message: 'Draft not found',
    });
  });

  it('returns 500 for unexpected delete failures', async () => {
    mockDeleteDraft.mockRejectedValue(new Error('delete failed'));

    const response = await request(app)
      .delete('/api/v1/wallets/wallet-1/drafts/draft-1');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Failed to delete draft');
  });
});
