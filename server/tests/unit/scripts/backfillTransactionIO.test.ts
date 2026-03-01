import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const {
  mockPrisma,
  mockClient,
  mockGetNodeClient,
  mockLogger,
} = vi.hoisted(() => ({
  mockPrisma: {
    transaction: {
      findMany: vi.fn(),
    },
    transactionInput: {
      createMany: vi.fn(),
    },
    transactionOutput: {
      createMany: vi.fn(),
    },
  },
  mockClient: {
    isConnected: vi.fn(),
    connect: vi.fn(),
    getTransaction: vi.fn(),
  },
  mockGetNodeClient: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/repositories/db', () => ({
  db: mockPrisma,
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: mockGetNodeClient,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

describe('backfillTransactionIO script', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockClient.isConnected.mockReturnValue(true);
    mockClient.connect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runScript(): Promise<{ exitSpy: ReturnType<typeof vi.spyOn> }> {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      return undefined as never;
    }) as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../../../src/scripts/backfillTransactionIO');
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    logSpy.mockRestore();
    errorSpy.mockRestore();

    return { exitSpy };
  }

  it('exits successfully when no transactions need backfill', async () => {
    (mockPrisma.transaction.findMany as Mock).mockResolvedValue([]);

    const { exitSpy } = await runScript();

    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith({
      where: {
        inputs: { none: {} },
        outputs: { none: {} },
      },
      include: {
        wallet: {
          include: {
            addresses: {
              select: { address: true, derivationPath: true },
            },
          },
        },
      },
      orderBy: { blockTime: 'asc' },
    });
    expect(mockGetNodeClient).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('backfills inputs/outputs and handles connect when client is disconnected', async () => {
    (mockPrisma.transaction.findMany as Mock).mockResolvedValue([
      {
        id: 'tx-row-1',
        txid: 'txid-1',
        type: 'sent',
        wallet: {
          addresses: [
            { address: 'our-change', derivationPath: "m/84'/1'/0'/1/0" },
            { address: 'our-recv', derivationPath: "m/84'/1'/0'/0/0" },
          ],
        },
      },
    ]);

    mockClient.isConnected.mockReturnValue(false);
    mockClient.getTransaction.mockResolvedValue({
      vin: [
        {
          txid: 'prev-tx',
          vout: 0,
          prevout: {
            value: 0.001, // BTC
            scriptPubKey: {
              address: 'our-recv',
            },
          },
        },
        {
          coinbase: 'coinbase',
        },
      ],
      vout: [
        {
          value: 0.0004,
          scriptPubKey: {
            address: 'our-change',
            hex: '0014abcd',
          },
        },
        {
          value: 0.0005,
          scriptPubKey: {
            addresses: ['external-recipient'],
            hex: '0014efgh',
          },
        },
      ],
    });
    (mockPrisma.transactionInput.createMany as Mock).mockResolvedValue({ count: 1 });
    (mockPrisma.transactionOutput.createMany as Mock).mockResolvedValue({ count: 2 });

    const { exitSpy } = await runScript();

    expect(mockGetNodeClient).toHaveBeenCalled();
    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockPrisma.transactionInput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-1',
          txid: 'prev-tx',
          vout: 0,
          address: 'our-recv',
          amount: BigInt(100000),
          derivationPath: "m/84'/1'/0'/0/0",
        }),
      ],
      skipDuplicates: true,
    });
    expect(mockPrisma.transactionOutput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-1',
          address: 'our-change',
          outputType: 'change',
          isOurs: true,
        }),
        expect.objectContaining({
          transactionId: 'tx-row-1',
          address: 'external-recipient',
          outputType: 'recipient',
          isOurs: false,
        }),
      ],
      skipDuplicates: true,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('counts fetch/process errors and still exits success', async () => {
    (mockPrisma.transaction.findMany as Mock).mockResolvedValue([
      {
        id: 'tx-row-1',
        txid: 'txid-fail',
        type: 'receive',
        wallet: { addresses: [] },
      },
      {
        id: 'tx-row-2',
        txid: 'txid-ok',
        type: 'consolidation',
        wallet: { addresses: [] },
      },
    ]);

    mockClient.getTransaction
      .mockRejectedValueOnce(new Error('electrum timeout'))
      .mockResolvedValueOnce({
        vin: [],
        vout: [
          {
            value: 0.0001,
            scriptPubKey: { address: 'x' },
          },
        ],
      });
    (mockPrisma.transactionInput.createMany as Mock).mockResolvedValue({ count: 0 });
    (mockPrisma.transactionOutput.createMany as Mock).mockResolvedValue({ count: 1 });

    const { exitSpy } = await runScript();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch tx txid-fail:'),
    );
    expect(mockPrisma.transactionOutput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-2',
          outputType: 'consolidation',
        }),
      ],
      skipDuplicates: true,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('resolves input details from previous transactions when prevout is missing', async () => {
    (mockPrisma.transaction.findMany as Mock).mockResolvedValue([
      {
        id: 'tx-row-prev',
        txid: 'txid-prev-lookup',
        type: 'received',
        wallet: { addresses: [{ address: 'our-wallet', derivationPath: "m/84'/1'/0'/0/7" }] },
      },
    ]);

    mockClient.getTransaction
      .mockResolvedValueOnce({
        vin: [{ txid: 'prev-source', vout: 1 }],
        vout: [
          {
            value: 0.001,
            scriptPubKey: { address: 'not-ours', hex: '0014ff' },
          },
        ],
      })
      .mockResolvedValueOnce({
        vout: [
          { value: 0.0005, scriptPubKey: { address: 'ignored' } },
          { value: 0.002, scriptPubKey: { addresses: ['prev-address'] } },
        ],
      });
    (mockPrisma.transactionInput.createMany as Mock).mockResolvedValue({ count: 1 });
    (mockPrisma.transactionOutput.createMany as Mock).mockResolvedValue({ count: 1 });

    const { exitSpy } = await runScript();

    expect(mockPrisma.transactionInput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-prev',
          txid: 'prev-source',
          vout: 1,
          address: 'prev-address',
          amount: BigInt(200000),
          derivationPath: undefined,
        }),
      ],
      skipDuplicates: true,
    });
    expect(mockPrisma.transactionOutput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-prev',
          outputType: 'unknown',
          isOurs: false,
        }),
      ],
      skipDuplicates: true,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('handles sparse tx details, prevout/address fallbacks, and skips non-addressable outputs', async () => {
    (mockPrisma.transaction.findMany as Mock).mockResolvedValue([
      {
        id: 'tx-row-edge-a',
        txid: 'txid-edge-a',
        type: 'receive',
        wallet: { addresses: [{ address: 'our-addr' }] },
      },
      {
        id: 'tx-row-edge-b',
        txid: 'txid-edge-b',
        type: 'sent',
        wallet: { addresses: [] },
      },
    ]);

    mockClient.getTransaction.mockImplementation(async (txid: string) => {
      if (txid === 'txid-edge-a') {
        return {
          vin: [
            {
              txid: 'prev-with-addresses',
              vout: 0,
              prevout: {
                scriptPubKey: { addresses: ['input-from-addresses'] },
                value: 1000000, // already sats path
              },
            },
            {
              txid: 'prev-no-address',
              vout: 1,
              prevout: {
                scriptPubKey: {},
              },
            },
            { txid: 'prev-lookup-missing', vout: 2 },
            { txid: 'prev-lookup-no-value', vout: 0 },
          ],
          vout: [
            {
              scriptPubKey: { address: 'our-addr', hex: '0014aa' },
            },
            {
              value: 0.0002,
              scriptPubKey: {},
            },
          ],
        };
      }
      if (txid === 'txid-edge-b') {
        return {};
      }
      if (txid === 'prev-lookup-missing') {
        return { vout: [] };
      }
      if (txid === 'prev-lookup-no-value') {
        return { vout: [{ scriptPubKey: { address: 'lookup-addr' } }] };
      }
      return {};
    });

    (mockPrisma.transactionInput.createMany as Mock).mockResolvedValue({ count: 2 });
    (mockPrisma.transactionOutput.createMany as Mock).mockResolvedValue({ count: 1 });

    const { exitSpy } = await runScript();

    expect(mockPrisma.transactionInput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-edge-a',
          txid: 'prev-with-addresses',
          vout: 0,
          address: 'input-from-addresses',
          amount: BigInt(1000000),
          derivationPath: undefined,
        }),
        expect.objectContaining({
          transactionId: 'tx-row-edge-a',
          txid: 'prev-lookup-no-value',
          vout: 0,
          address: 'lookup-addr',
          amount: BigInt(0),
          derivationPath: undefined,
        }),
      ],
      skipDuplicates: true,
    });
    expect(mockPrisma.transactionOutput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-edge-a',
          address: 'our-addr',
          amount: BigInt(0),
          outputType: 'recipient',
          isOurs: true,
        }),
      ],
      skipDuplicates: true,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('logs periodic progress every 50 processed transactions', async () => {
    const txs = Array.from({ length: 50 }, (_, i) => ({
      id: `tx-row-${i}`,
      txid: `txid-${i}`,
      type: 'sent',
      wallet: { addresses: [] },
    }));

    (mockPrisma.transaction.findMany as Mock).mockResolvedValue(txs);
    mockClient.getTransaction.mockResolvedValue({
      vin: [],
      vout: [
        {
          value: 0.0001,
          scriptPubKey: { address: 'recipient-address', hex: '0014abcd' },
        },
      ],
    });
    (mockPrisma.transactionInput.createMany as Mock).mockResolvedValue({ count: 0 });
    (mockPrisma.transactionOutput.createMany as Mock).mockResolvedValue({ count: 1 });

    const { exitSpy } = await runScript();

    expect(mockLogger.info).toHaveBeenCalledWith('[BACKFILL] Progress: 50/50 transactions processed');
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('counts processing errors when database insert fails', async () => {
    (mockPrisma.transaction.findMany as Mock).mockResolvedValue([
      {
        id: 'tx-row-error',
        txid: 'txid-error',
        type: 'sent',
        wallet: { addresses: [] },
      },
    ]);
    mockClient.getTransaction.mockResolvedValue({
      vin: [],
      vout: [
        {
          value: 0.0001,
          scriptPubKey: { address: 'recipient-address', hex: '0014abcd' },
        },
      ],
    });
    (mockPrisma.transactionOutput.createMany as Mock).mockRejectedValue(new Error('write failed'));

    const { exitSpy } = await runScript();

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error processing tx txid-error'));
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('skips malformed inputs without prevout/txid-vout and keeps unknown type for unclassified transactions', async () => {
    (mockPrisma.transaction.findMany as Mock).mockResolvedValue([
      {
        id: 'tx-row-unclassified',
        txid: 'txid-unclassified',
        type: 'self_transfer',
        wallet: { addresses: [] },
      },
    ]);

    mockClient.getTransaction.mockResolvedValue({
      vin: [
        { sequence: 1 }, // no prevout and no txid/vout
      ],
      vout: [
        {
          value: 0.0003,
          scriptPubKey: { address: 'external-address', hex: '0014beef' },
        },
      ],
    });
    (mockPrisma.transactionOutput.createMany as Mock).mockResolvedValue({ count: 1 });

    const { exitSpy } = await runScript();

    expect(mockPrisma.transactionInput.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.transactionOutput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          transactionId: 'tx-row-unclassified',
          address: 'external-address',
          outputType: 'unknown',
          isOurs: false,
        }),
      ],
      skipDuplicates: true,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('exits with failure code when script initialization throws', async () => {
    (mockPrisma.transaction.findMany as Mock).mockRejectedValue(new Error('database unavailable'));

    const { exitSpy } = await runScript();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
