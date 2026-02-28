import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../mocks/electrum';
import { testnetAddresses } from '../../../fixtures/bitcoin';

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../src/services/bitcoin/utils', () => ({
  validateAddress: vi.fn().mockReturnValue({ valid: true }),
  parseTransaction: vi.fn(),
  getNetwork: vi.fn().mockReturnValue(require('bitcoinjs-lib').networks.testnet),
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

import { syncAddress, checkAddress } from '../../../../src/services/bitcoin/blockchain';
import { validateAddress } from '../../../../src/services/bitcoin/utils';

describe('Blockchain syncAddress branch coverage', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
  });

  it('handles previous-tx batch fetch, consolidation detection, UTXO insert, and IO persistence', async () => {
    const addressId = 'addr-id';
    const walletId = 'wallet-id';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const changeAddress = testnetAddresses.nativeSegwit[1];
    const externalAddress = 'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

    const txMain = 'a'.repeat(64);
    const txMissing = 'b'.repeat(64);
    const prevTx = 'c'.repeat(64);
    const utxoOnlyTx = 'd'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });

    mockPrismaClient.address.findMany.mockResolvedValue([
      { address: mainAddress },
      { address: changeAddress },
    ]);

    mockElectrumClient.getAddressHistory.mockResolvedValue([
      { tx_hash: txMissing, height: 101 },
      { tx_hash: txMain, height: 100 },
    ]);

    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'sent-1', txid: 's'.repeat(64), type: 'sent' },
        { id: 'recv-1', txid: 'r'.repeat(64), type: 'received' },
        { id: 'cons-1', txid: 'k'.repeat(64), type: 'consolidation' },
        { id: 'skip-1', txid: 'z'.repeat(64), type: 'sent' },
      ]);

    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
      if (txids.includes(txMain)) {
        return new Map([
          [
            txMain,
            {
              txid: txMain,
              hex: '00',
              vin: [{ txid: prevTx, vout: 0 }],
              vout: [
                { value: 0.0005, n: 0, scriptPubKey: { hex: '0014' + '11'.repeat(20), address: mainAddress } },
                { value: 0.0004, n: 1, scriptPubKey: { hex: '0014' + '22'.repeat(20), address: changeAddress } },
              ],
            },
          ],
        ]);
      }
      if (txids.includes(prevTx)) {
        return new Map([
          [
            prevTx,
            {
              txid: prevTx,
              hex: '00',
              vin: [],
              vout: [
                { value: 0.001, n: 0, scriptPubKey: { hex: '0014' + '33'.repeat(20), address: mainAddress } },
              ],
            },
          ],
        ]);
      }
      if (txids.includes(utxoOnlyTx)) {
        return new Map([
          [
            utxoOnlyTx,
            {
              txid: utxoOnlyTx,
              hex: '00',
              vin: [],
              vout: [
                { value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '44'.repeat(20), address: mainAddress } },
              ],
            },
          ],
        ]);
      }
      if (txids.includes('s'.repeat(64))) {
        return new Map([
          [
            's'.repeat(64),
            {
              txid: 's'.repeat(64),
              hex: '00',
              vin: [
                {
                  txid: 'x'.repeat(64),
                  vout: 0,
                  prevout: {
                    value: 2_000_000,
                    scriptPubKey: { hex: '0014' + '55'.repeat(20), address: mainAddress },
                  },
                },
              ],
              vout: [
                { value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '66'.repeat(20), address: externalAddress } },
                { value: 0.0002, n: 1, scriptPubKey: { hex: '0014' + '77'.repeat(20), address: mainAddress } },
              ],
            },
          ],
          [
            'r'.repeat(64),
            {
              txid: 'r'.repeat(64),
              hex: '00',
              vin: [],
              vout: [
                { value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '88'.repeat(20), address: mainAddress } },
              ],
            },
          ],
          [
            'k'.repeat(64),
            {
              txid: 'k'.repeat(64),
              hex: '00',
              vin: [],
              vout: [
                { value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '99'.repeat(20), address: changeAddress } },
              ],
            },
          ],
        ]);
      }
      return new Map();
    });

    mockElectrumClient.getAddressUTXOs.mockResolvedValue([
      { tx_hash: txMain, tx_pos: 1, value: 40_000, height: 100 },
      { tx_hash: utxoOnlyTx, tx_pos: 0, value: 20_000, height: 105 },
    ]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(110);

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(2);
    expect(result.utxos).toBe(2);
    expect(mockPrismaClient.transaction.create).toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ txid: txMain, vout: 1 }),
          expect.objectContaining({ txid: utxoOnlyTx, vout: 0 }),
        ]),
      })
    );
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalled();
  });

  it('swallows I/O persistence errors and still returns sync result', async () => {
    const addressId = 'addr-io-error';
    const walletId = 'wallet-io-error';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const historyTx = 'e'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'regtest' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: historyTx, height: 1 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(
      new Map([
        [
          historyTx,
          {
            txid: historyTx,
            hex: '00',
            vin: [],
            vout: [{ value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + 'aa'.repeat(20), address: mainAddress } }],
          },
        ],
      ])
    );
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockRejectedValue(new Error('height unavailable'));
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('io persistence failed'));

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(result.utxos).toBe(0);
  });

  it('creates a sent transaction with unknown fee when wallet input value is missing', async () => {
    const addressId = 'addr-sent';
    const walletId = 'wallet-sent';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const txid = 'f'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 500 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(
      new Map([
        [
          txid,
          {
            txid,
            hex: '00',
            vin: [
              {
                txid: 'p'.repeat(64),
                vout: 0,
                prevout: {
                  scriptPubKey: {
                    hex: '0014' + 'bb'.repeat(20),
                    address: mainAddress,
                  },
                },
              },
            ],
            vout: [
              { value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + 'cc'.repeat(20), address: externalAddress } },
              { value: 0.0002, n: 1, scriptPubKey: { hex: '0014' + 'dd'.repeat(20), address: mainAddress } },
            ],
          },
        ],
      ])
    );
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(510);
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([{ txid, type: 'received' }])
      .mockResolvedValueOnce([]);

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'sent',
          fee: null,
          amount: BigInt(-10_000),
        }),
      })
    );
  });

  it('handles existing and incomplete UTXOs while skipping empty I/O persistence batches', async () => {
    const addressId = 'addr-utxo-edge';
    const walletId = 'wallet-utxo-edge';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const historyTx = 'g'.repeat(64);
    const existingUtxoTx = 'h'.repeat(64);
    const missingUtxoTx = 'i'.repeat(64);
    const zeroHeightUtxoTx = 'j'.repeat(64);
    const ioTx = 'k'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: historyTx, height: 100 }]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([
      { tx_hash: existingUtxoTx, tx_pos: 0, value: 11_000, height: 120 },
      { tx_hash: missingUtxoTx, tx_pos: 0, value: 12_000, height: 121 },
      { tx_hash: zeroHeightUtxoTx, tx_pos: 0, value: 13_000, height: 0 },
    ]);
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'io-1', txid: ioTx, type: 'received' }]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([{ txid: existingUtxoTx, vout: 0 }]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(150);

    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
      if (txids.includes(historyTx)) {
        return new Map([
          [
            historyTx,
            {
              txid: historyTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '11'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }
      if (txids.includes(zeroHeightUtxoTx)) {
        return new Map([
          [
            zeroHeightUtxoTx,
            {
              txid: zeroHeightUtxoTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.00013, n: 0, scriptPubKey: { hex: '0014' + '12'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }
      if (txids.includes(ioTx)) {
        return new Map([
          [
            ioTx,
            {
              txid: ioTx,
              hex: '00',
              vout: [{ value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '13'.repeat(20) } }],
            },
          ],
        ]);
      }
      return new Map();
    });

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(result.utxos).toBe(1);
    expect(mockPrismaClient.transactionInput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            txid: zeroHeightUtxoTx,
            confirmations: 0,
            blockHeight: null,
          }),
        ]),
      })
    );
  });

  it('covers I/O parsing fallbacks for input/output classification', async () => {
    const addressId = 'addr-io-branches';
    const walletId = 'wallet-io-branches';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const historyTx = 'l'.repeat(64);
    const sentTx = 'm'.repeat(64);
    const receivedTx = 'n'.repeat(64);
    const consolidationTx = 'o'.repeat(64);
    const prevInputTx = 'p'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: historyTx, height: 600 }]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(610);
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'sent-io', txid: sentTx, type: 'sent' },
        { id: 'recv-io', txid: receivedTx, type: 'received' },
        { id: 'cons-io', txid: consolidationTx, type: 'consolidation' },
      ]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
      if (txids.includes(historyTx)) {
        return new Map([
          [
            historyTx,
            {
              txid: historyTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '21'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }

      if (txids.includes(sentTx)) {
        return new Map([
          [
            sentTx,
            {
              txid: sentTx,
              hex: '00',
              vin: [
                { coinbase: true },
                {
                  txid: prevInputTx,
                  vout: 0,
                  prevout: {
                    scriptPubKey: {
                      hex: '0014' + '22'.repeat(20),
                      addresses: [mainAddress],
                    },
                  },
                },
                {
                  vout: 1,
                  prevout: {
                    value: 0.0003,
                    scriptPubKey: {
                      hex: '0014' + '23'.repeat(20),
                      address: mainAddress,
                    },
                  },
                },
                {
                  txid: 'q'.repeat(64),
                  vout: 2,
                },
              ],
              vout: [
                { value: 0, n: 0, scriptPubKey: { hex: '0014' + '24'.repeat(20), addresses: [externalAddress] } },
                { value: 0.0001, n: 1, scriptPubKey: { hex: '0014' + '25'.repeat(20), address: mainAddress } },
              ],
            },
          ],
          [
            receivedTx,
            {
              txid: receivedTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '26'.repeat(20), address: externalAddress } }],
            },
          ],
          [
            consolidationTx,
            {
              txid: consolidationTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0004, n: 0, scriptPubKey: { hex: '0014' + '27'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }

      return new Map();
    });

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            transactionId: 'sent-io',
            txid: prevInputTx,
            amount: BigInt(0),
          }),
        ]),
      })
    );
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ transactionId: 'recv-io', outputType: 'unknown' }),
          expect.objectContaining({ transactionId: 'cons-io', outputType: 'consolidation' }),
        ]),
      })
    );
  });

  it('covers sent/received skip paths, address fallbacks, and consolidation I/O branches', async () => {
    const addressId = 'addr-skip-branches';
    const walletId = 'wallet-skip-branches';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const changeAddress = testnetAddresses.nativeSegwit[1];
    const externalAddress = 'tb1q8n7f9k3m0v6x5p4s2t1w0y8z7a6b5c4d3e2f1g';

    const receivedTx = 'u'.repeat(64);
    const sentTx = 'v'.repeat(64);
    const existingSentTx = 'w'.repeat(64);
    const existingConsolidationTx = 'x'.repeat(64);
    const missingFieldsTx = 'y'.repeat(64);
    const noDestinationTx = '3'.repeat(64);
    const unknownTypeTx = '4'.repeat(64);
    const prevLookupTx = 'z'.repeat(64);
    const prevNoAddrTx = '1'.repeat(64);
    const prevMissingTx = '2'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { address: mainAddress },
      { address: changeAddress },
    ]);

    mockElectrumClient.getAddressHistory.mockResolvedValue([
      { tx_hash: receivedTx, height: 0 },
      { tx_hash: sentTx, height: 0 },
      { tx_hash: existingSentTx, height: 1 },
      { tx_hash: existingConsolidationTx, height: 2 },
      { tx_hash: missingFieldsTx, height: 3 },
      { tx_hash: noDestinationTx, height: 4 },
      { tx_hash: unknownTypeTx, height: 5 },
    ]);

    let batchCall = 0;
    mockElectrumClient.getTransactionsBatch.mockImplementation(async () => {
      batchCall += 1;

      if (batchCall === 1) {
        return new Map([
          [
            receivedTx,
            {
              txid: receivedTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '31'.repeat(20), addresses: [mainAddress] } }],
            },
          ],
          [
            sentTx,
            {
              txid: sentTx,
              hex: '00',
              vin: [
                { coinbase: true },
                {
                  prevout: {
                    value: 0.0005,
                    scriptPubKey: { hex: '0014' + '32'.repeat(20), addresses: [mainAddress] },
                  },
                },
                {
                  prevout: {
                    value: 0.0001,
                    scriptPubKey: { hex: '0014' + '33'.repeat(20) },
                  },
                },
                {},
                { txid: prevMissingTx, vout: 0 },
              ],
              vout: [
                { value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '34'.repeat(20), addresses: [externalAddress] } },
                { value: 0.0002, n: 1, scriptPubKey: { hex: '0014' + '35'.repeat(20), address: mainAddress } },
                { value: 0.00001, n: 2 },
              ],
            },
          ],
          [
            existingSentTx,
            {
              txid: existingSentTx,
              hex: '00',
              vin: [
                { txid: prevLookupTx, vout: 0 },
                { txid: prevNoAddrTx, vout: 0 },
              ],
              vout: [{ value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '36'.repeat(20), address: externalAddress } }],
            },
          ],
          [
            existingConsolidationTx,
            {
              txid: existingConsolidationTx,
              hex: '00',
              vin: [
                {
                  prevout: {
                    value: 0.0004,
                    scriptPubKey: { hex: '0014' + '37'.repeat(20), address: mainAddress },
                  },
                },
              ],
              vout: [{ value: 0.00039, n: 0, scriptPubKey: { hex: '0014' + '38'.repeat(20), address: changeAddress } }],
            },
          ],
          [missingFieldsTx, { txid: missingFieldsTx, hex: '00' }],
          [
            noDestinationTx,
            {
              txid: noDestinationTx,
              hex: '00',
              vin: [
                {
                  prevout: {
                    value: 0.0006,
                    scriptPubKey: { hex: '0014' + '42'.repeat(20), address: mainAddress },
                  },
                },
              ],
              vout: [{ value: 0.00059, n: 0 }],
            },
          ],
          [unknownTypeTx, { txid: unknownTypeTx, hex: '00', vin: [], vout: [] }],
        ]);
      }

      if (batchCall === 2) {
        return new Map([
          [
            prevLookupTx,
            {
              txid: prevLookupTx,
              hex: '00',
              vout: [{ value: 0.0008, n: 0, scriptPubKey: { hex: '0014' + '39'.repeat(20), addresses: [mainAddress] } }],
            },
          ],
          [
            prevNoAddrTx,
            {
              txid: prevNoAddrTx,
              hex: '00',
              vout: [{ value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '40'.repeat(20) } }],
            },
          ],
        ]);
      }

      return new Map([
        [
          existingConsolidationTx,
          {
            txid: existingConsolidationTx,
            hex: '00',
            vin: [],
            vout: [{ value: 0.00039, n: 0, scriptPubKey: { hex: '0014' + '41'.repeat(20), address: mainAddress } }],
          },
        ],
        [missingFieldsTx, { txid: missingFieldsTx, hex: '00', vin: [] }],
        [
          unknownTypeTx,
          {
            txid: unknownTypeTx,
            hex: '00',
            vin: [],
            vout: [{ value: 0.00011, n: 0, scriptPubKey: { hex: '0014' + '43'.repeat(20), address: externalAddress } }],
          },
        ],
      ]);
    });

    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([
        { txid: existingSentTx, type: 'sent' },
        { txid: existingConsolidationTx, type: 'consolidation' },
      ])
      .mockResolvedValueOnce([
        { id: 'io-cons', txid: existingConsolidationTx, type: 'consolidation' },
        { id: 'io-empty', txid: missingFieldsTx, type: 'sent' },
        { id: 'io-unknown', txid: unknownTypeTx, type: 'unknown' as any },
      ]);

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(3);
    expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          txid: receivedTx,
          type: 'received',
          confirmations: 0,
          blockHeight: null,
        }),
      })
    );
    expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          txid: sentTx,
          type: 'sent',
          confirmations: 0,
          blockHeight: null,
        }),
      })
    );
    expect(mockPrismaClient.transaction.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ txid: existingSentTx }),
      })
    );
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            transactionId: 'io-cons',
            outputType: 'consolidation',
          }),
          expect.objectContaining({
            transactionId: 'io-unknown',
            outputType: 'unknown',
          }),
        ]),
      })
    );
  });

  it('rethrows syncAddress errors after logging', async () => {
    const addressId = 'addr-sync-error';
    const walletId = 'wallet-sync-error';
    const mainAddress = testnetAddresses.nativeSegwit[0];

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });
    mockElectrumClient.getAddressHistory.mockRejectedValue(new Error('history fetch failed'));

    await expect(syncAddress(addressId)).rejects.toThrow('history fetch failed');
  });

  it('returns validation failure from checkAddress without hitting the network', async () => {
    vi.mocked(validateAddress).mockReturnValueOnce({
      valid: false,
      error: 'Invalid address format',
    });

    const result = await checkAddress('bad-address', 'testnet');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid address');
    expect(mockElectrumClient.getAddressBalance).not.toHaveBeenCalled();
  });
});
