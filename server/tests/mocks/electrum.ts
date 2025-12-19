/**
 * Electrum Client Mock
 *
 * Mocks the Electrum/node client for testing blockchain interactions.
 */

export interface MockElectrumTransaction {
  txid: string;
  hex: string;
  blockheight?: number;
  confirmations?: number;
  time?: number;
  vin: Array<{
    txid?: string;
    vout?: number;
    coinbase?: boolean;
    prevout?: {
      value: number;
      scriptPubKey: {
        hex: string;
        address?: string;
        addresses?: string[];
      };
    };
  }>;
  vout: Array<{
    value: number;
    n: number;
    scriptPubKey: {
      hex: string;
      address?: string;
      addresses?: string[];
    };
  }>;
}

export interface MockUTXO {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
}

export interface MockAddressHistory {
  tx_hash: string;
  height: number;
}

// Create the mock Electrum client
export const mockElectrumClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockReturnValue(true),

  // Transaction methods
  getTransaction: jest.fn().mockResolvedValue(null),
  getTransactionsBatch: jest.fn().mockResolvedValue(new Map()),
  broadcastTransaction: jest.fn().mockResolvedValue('mock-txid'),

  // Address methods
  getAddressHistory: jest.fn().mockResolvedValue([]),
  getAddressHistoryBatch: jest.fn().mockResolvedValue(new Map()),
  getAddressBalance: jest.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
  getAddressUTXOs: jest.fn().mockResolvedValue([]),
  getAddressUTXOsBatch: jest.fn().mockResolvedValue(new Map()),
  subscribeAddress: jest.fn().mockResolvedValue('subscription-id'),

  // Block methods
  getBlockHeight: jest.fn().mockResolvedValue(800000),
  getBlockHeader: jest.fn().mockResolvedValue('0'.repeat(160)),

  // Fee estimation
  estimateFee: jest.fn().mockResolvedValue(10),
};

// Helper to create mock transaction
export function createMockTransaction(options: {
  txid?: string;
  hex?: string;
  blockheight?: number;
  confirmations?: number;
  inputs?: Array<{
    txid: string;
    vout: number;
    value: number;
    address: string;
  }>;
  outputs?: Array<{
    value: number;
    address: string;
  }>;
}): MockElectrumTransaction {
  const txid = options.txid || 'a'.repeat(64);

  return {
    txid,
    hex: options.hex || '0200000001' + '0'.repeat(200),
    blockheight: options.blockheight,
    confirmations: options.confirmations || 0,
    time: options.blockheight ? Date.now() / 1000 - (800000 - options.blockheight) * 600 : undefined,
    vin: (options.inputs || []).map((input) => ({
      txid: input.txid,
      vout: input.vout,
      prevout: {
        value: input.value,
        scriptPubKey: {
          hex: '0014' + 'a'.repeat(40),
          address: input.address,
        },
      },
    })),
    vout: (options.outputs || []).map((output, index) => ({
      value: output.value,
      n: index,
      scriptPubKey: {
        hex: '0014' + 'b'.repeat(40),
        address: output.address,
      },
    })),
  };
}

// Helper to create mock UTXO
export function createMockUTXO(options: {
  txid?: string;
  vout?: number;
  value: number;
  height?: number;
}): MockUTXO {
  return {
    tx_hash: options.txid || 'c'.repeat(64),
    tx_pos: options.vout ?? 0,
    value: options.value,
    height: options.height ?? 799999,
  };
}

// Helper to create mock address history
export function createMockAddressHistory(options: {
  txid?: string;
  height?: number;
}[]): MockAddressHistory[] {
  return options.map((opt) => ({
    tx_hash: opt.txid || 'd'.repeat(64),
    height: opt.height ?? 799999,
  }));
}

// Reset all Electrum mocks
export function resetElectrumMocks(): void {
  Object.values(mockElectrumClient).forEach((method) => {
    if (typeof method === 'function' && 'mockClear' in method) {
      (method as jest.Mock).mockClear();
    }
  });
}

// Setup common mock returns
export function setupElectrumMockReturns(config: {
  blockHeight?: number;
  feeRate?: number;
  transactions?: Map<string, MockElectrumTransaction>;
  utxos?: Map<string, MockUTXO[]>;
  history?: Map<string, MockAddressHistory[]>;
}): void {
  if (config.blockHeight !== undefined) {
    mockElectrumClient.getBlockHeight.mockResolvedValue(config.blockHeight);
  }
  if (config.feeRate !== undefined) {
    mockElectrumClient.estimateFee.mockResolvedValue(config.feeRate);
  }
  if (config.transactions) {
    mockElectrumClient.getTransaction.mockImplementation((txid: string) => {
      return Promise.resolve(config.transactions?.get(txid) || null);
    });
  }
  if (config.utxos) {
    mockElectrumClient.getAddressUTXOs.mockImplementation((address: string) => {
      return Promise.resolve(config.utxos?.get(address) || []);
    });
  }
  if (config.history) {
    mockElectrumClient.getAddressHistory.mockImplementation((address: string) => {
      return Promise.resolve(config.history?.get(address) || []);
    });
  }
}

export default mockElectrumClient;
