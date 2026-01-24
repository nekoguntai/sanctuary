import { describe, expect, it, vi, beforeEach } from 'vitest';

const hoistedTrace = vi.hoisted(() => ({
  traceExternalCall: vi.fn(async (_service: string, _op: string, fn: () => any) => fn()),
}));

vi.mock('../../../../../src/utils/tracing', () => ({
  traceExternalCall: hoistedTrace.traceExternalCall,
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const hoisted = vi.hoisted(() => {
  const { EventEmitter } = require('events');

  const mockTx = (txid: string) => ({
    txid,
    hash: `${txid}-hash`,
    version: 2,
    size: 120,
    vsize: 110,
    weight: 440,
    locktime: 0,
    vin: [{ txid: 'prev', vout: 0, sequence: 1 }],
    vout: [
      { value: 0.0001, scriptPubKey: { hex: '76a9', address: 'addr1' } },
    ],
    hex: 'deadbeef',
    blockhash: 'blockhash',
    confirmations: 3,
    time: 100,
    blocktime: 100,
  });

  class MockElectrumClient extends EventEmitter {
    static instances: MockElectrumClient[] = [];
    config: any;
    connected = false;

    constructor(config: any) {
      super();
      this.config = config;
      MockElectrumClient.instances.push(this);
    }

    isConnected = vi.fn(() => this.connected);
    connect = vi.fn(async () => {
      this.connected = true;
    });
    disconnect = vi.fn(() => {
      this.connected = false;
    });

    getBlockHeight = vi.fn(async () => 123);
    getServerVersion = vi.fn(async () => ({ server: 'ElectrumX', protocol: '1.4' }));

    getAddressBalance = vi.fn(async () => ({ confirmed: 1, unconfirmed: 2 }));
    getAddressHistory = vi.fn(async () => [{ tx_hash: 'tx1', height: 5 }]);
    getAddressHistoryBatch = vi.fn(async (addresses: string[]) => new Map(
      addresses.map((addr) => [addr, [{ tx_hash: `${addr}-tx`, height: 1 }]])
    ));
    getAddressUTXOs = vi.fn(async () => [{ tx_hash: 'tx', tx_pos: 1, value: 1000, height: 2 }]);

    getTransaction = vi.fn(async (txid: string) => mockTx(txid));
    getTransactionsBatch = vi.fn(async (txids: string[]) => new Map(
      txids.map((txid) => [txid, mockTx(txid)])
    ));
    broadcastTransaction = vi.fn(async (hex: string) => `sent-${hex}`);

    getBlockHeader = vi.fn(async (height: number) => ({
      block_hash: 'hash',
      height,
      version: 2,
      prev_block_hash: 'prev',
      merkle_root: 'merkle',
      timestamp: 100,
      bits: '1d00',
      nonce: 0,
      hex: 'hex',
    }));

    estimateFee = vi.fn(async () => 0.0001);

    subscribeAddress = vi.fn(async () => 'status');
    unsubscribeAddress = vi.fn(async () => undefined);
    subscribeHeaders = vi.fn(async () => ({ height: 1, hex: '00' }));
  }

  return { MockElectrumClient, mockTx };
});

vi.mock('../../../../../src/services/bitcoin/electrum', () => ({
  __esModule: true,
  default: hoisted.MockElectrumClient,
}));

import { ElectrumProvider, electrumProviderFactory } from '../../../../../src/services/bitcoin/providers/electrumProvider';

const baseConfig = {
  type: 'electrum',
  host: 'electrum.example.com',
  port: 50002,
  protocol: 'ssl',
  network: 'mainnet',
  allowSelfSignedCert: true,
  timeoutMs: 5000,
};

const getClient = () =>
  hoisted.MockElectrumClient.instances[hoisted.MockElectrumClient.instances.length - 1];

describe('ElectrumProvider', () => {
  beforeEach(() => {
    hoisted.MockElectrumClient.instances.length = 0;
    vi.clearAllMocks();
  });

  it('connects only when not already connected', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const client = getClient();

    client.isConnected.mockReturnValue(false);
    await provider.connect();
    expect(client.connect).toHaveBeenCalled();

    client.connect.mockClear();
    client.isConnected.mockReturnValue(true);
    await provider.connect();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('disconnects via client', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const client = getClient();
    provider.disconnect();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('reports health on success and failure', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const client = getClient();

    const healthy = await provider.getHealth();
    expect(healthy.connected).toBe(true);
    expect(healthy.blockHeight).toBe(123);
    expect(healthy.serverInfo).toContain('ElectrumX');

    client.getBlockHeight.mockRejectedValueOnce(new Error('down'));
    const unhealthy = await provider.getHealth();
    expect(unhealthy.connected).toBe(false);
    expect(unhealthy.blockHeight).toBe(0);
  });

  it('maps address balance and history', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const balance = await provider.getAddressBalance('addr');
    expect(balance).toEqual({ confirmed: BigInt(1), unconfirmed: BigInt(2) });

    const history = await provider.getAddressHistory('addr');
    expect(history).toEqual([{ txid: 'tx1', height: 5 }]);
  });

  it('returns batch histories as map', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const histories = await provider.getAddressHistories(['a1', 'a2']);
    expect(histories.get('a1')).toEqual([{ txid: 'a1-tx', height: 1 }]);
    expect(histories.get('a2')).toEqual([{ txid: 'a2-tx', height: 1 }]);
  });

  it('maps UTXOs and batches', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const utxos = await provider.getAddressUTXOs('addr');
    expect(utxos).toEqual([{ txid: 'tx', vout: 1, value: BigInt(1000), height: 2 }]);

    const batch = await provider.getAddressUTXOsBatch(['a1', 'a2']);
    expect(batch.get('a1')?.length).toBe(1);
    expect(batch.get('a2')?.length).toBe(1);
  });

  it('maps transactions and supports verbose false', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const tx = await provider.getTransaction('txid', true);
    expect((tx as any).txid).toBe('txid');
    expect((tx as any).vout[0].value).toBe(BigInt(10000));

    const hex = await provider.getTransaction('txid', false);
    expect(hex).toBe('deadbeef');
  });

  it('maps transaction batch with verbose flag', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const results = await provider.getTransactions(['t1', 't2'], false);
    expect(results.get('t1')).toBe('deadbeef');
    expect(results.get('t2')).toBe('deadbeef');
  });

  it('converts fee estimates and enforces minimum', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const client = getClient();

    client.estimateFee.mockResolvedValueOnce(0.0002);
    const fee = await provider.estimateFee(1);
    expect(fee).toBe(20);

    client.estimateFee.mockResolvedValueOnce(-1);
    const minFee = await provider.estimateFee(1);
    expect(minFee).toBe(1);
  });

  it('returns block header and rejects hash lookup', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const header = await provider.getBlockHeader(10);
    expect(header.hash).toBe('hash');
    expect(header.height).toBe(10);

    await expect(provider.getBlockHeaderByHash('hash')).rejects.toThrow('not supported');
  });

  it('subscribes to address and returns unsubscribe', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const client = getClient();
    const callback = vi.fn();

    const unsubscribe = await provider.subscribeToAddress('addr', callback);
    expect(callback).toHaveBeenCalledWith('addr', 'status');

    client.emit('address.update', 'addr', 'new-status');
    expect(callback).toHaveBeenCalledWith('addr', 'new-status');

    unsubscribe();
    expect(client.unsubscribeAddress).toHaveBeenCalledWith('addr');
  });

  it('subscribes to blocks and returns unsubscribe', async () => {
    const provider = new ElectrumProvider(baseConfig as any);
    const client = getClient();
    const callback = vi.fn();

    const unsubscribe = await provider.subscribeToBlocks(callback);
    client.emit('block.update', 100, 'headerhex');

    expect(callback).toHaveBeenCalledWith(100, expect.objectContaining({ height: 100 }));
    unsubscribe();
  });
});

describe('electrumProviderFactory', () => {
  beforeEach(() => {
    hoisted.MockElectrumClient.instances.length = 0;
    vi.clearAllMocks();
  });

  it('throws for non-electrum config', async () => {
    await expect(electrumProviderFactory({ type: 'mempool' } as any)).rejects.toThrow('Invalid config type');
  });

  it('creates and connects provider', async () => {
    const provider = await electrumProviderFactory(baseConfig as any);
    expect(provider.type).toBe('electrum');
    const client = getClient();
    expect(client.connect).toHaveBeenCalled();
  });
});
