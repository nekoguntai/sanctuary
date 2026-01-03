/**
 * Broadcast Helpers Tests
 *
 * Tests for type-safe WebSocket broadcast functions.
 */

import {
  broadcastTransaction,
  broadcastBalance,
  broadcastConfirmation,
  broadcastSync,
  broadcastLog,
  broadcastBlock,
  broadcastNewBlock,
  broadcastMempool,
  broadcastModelDownload,
  broadcast,
  hasWalletSubscribers,
  getBroadcastStats,
} from '../../../src/websocket/broadcast';

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock the WebSocket server
const mockBroadcast = jest.fn();
const mockGetStats = jest.fn().mockReturnValue({
  clients: 5,
  maxClients: 10000,
  subscriptions: 15,
  channels: 3,
  channelList: ['wallet:123', 'wallet:456', 'blocks'],
  uniqueUsers: 2,
  maxPerUser: 10,
  rateLimits: {
    maxMessagesPerSecond: 10,
    gracePeriodMs: 5000,
    gracePeriodMessageLimit: 500,
    maxSubscriptionsPerConnection: 500,
  },
});
const mockIsGatewayConnected = jest.fn().mockReturnValue(false);
const mockSendEvent = jest.fn();

jest.mock('../../../src/websocket/server', () => ({
  getWebSocketServer: jest.fn(() => ({
    broadcast: mockBroadcast,
    getStats: mockGetStats,
  })),
  getGatewayWebSocketServer: jest.fn(() => ({
    isGatewayConnected: mockIsGatewayConnected,
    sendEvent: mockSendEvent,
  })),
}));

describe('Broadcast Helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('broadcastTransaction', () => {
    it('should broadcast transaction event', () => {
      broadcastTransaction('wallet-123', {
        txid: 'tx-abc',
        type: 'received',
        amount: 100000,
        confirmations: 0,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transaction',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            txid: 'tx-abc',
            type: 'received',
            amount: 100000,
            confirmations: 0,
          }),
        })
      );
    });

    it('should handle string timestamp', () => {
      broadcastTransaction('wallet-123', {
        txid: 'tx-abc',
        type: 'sent',
        amount: 100000,
        confirmations: 3,
        timestamp: '2024-01-01T00:00:00Z',
      });

      expect(mockBroadcast).toHaveBeenCalled();
    });

    it('should handle consolidation type', () => {
      broadcastTransaction('wallet-123', {
        txid: 'tx-abc',
        type: 'consolidation',
        amount: 0,
        confirmations: 1,
        timestamp: new Date(),
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'consolidation',
          }),
        })
      );
    });
  });

  describe('broadcastBalance', () => {
    it('should broadcast balance event', () => {
      broadcastBalance('wallet-123', {
        balance: 500000,
        unconfirmed: 50000,
        change: 25000,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'balance',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            balance: 500000,
            unconfirmed: 50000,
            change: 25000,
          }),
        })
      );
    });

    it('should add timestamp if not provided', () => {
      broadcastBalance('wallet-123', {
        balance: 100000,
        unconfirmed: 0,
        change: 0,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timestamp: expect.any(String),
          }),
        })
      );
    });
  });

  describe('broadcastConfirmation', () => {
    it('should broadcast confirmation event', () => {
      broadcastConfirmation('wallet-123', {
        txid: 'tx-abc',
        confirmations: 6,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirmation',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            txid: 'tx-abc',
            confirmations: 6,
          }),
        })
      );
    });

    it('should include previous confirmations when provided', () => {
      broadcastConfirmation('wallet-123', {
        txid: 'tx-abc',
        confirmations: 6,
        previousConfirmations: 5,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousConfirmations: 5,
          }),
        })
      );
    });
  });

  describe('broadcastSync', () => {
    it('should broadcast sync started event', () => {
      broadcastSync('wallet-123', {
        inProgress: true,
        status: 'started',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            inProgress: true,
            status: 'started',
          }),
        })
      );
    });

    it('should broadcast sync completed event', () => {
      broadcastSync('wallet-123', {
        inProgress: false,
        status: 'completed',
        lastSyncedAt: new Date().toISOString(),
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inProgress: false,
            status: 'completed',
          }),
        })
      );
    });

    it('should include retry information', () => {
      broadcastSync('wallet-123', {
        inProgress: true,
        status: 'retrying',
        retryCount: 2,
        maxRetries: 5,
        retryingIn: 30000,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            retryCount: 2,
            maxRetries: 5,
            retryingIn: 30000,
          }),
        })
      );
    });
  });

  describe('broadcastLog', () => {
    it('should broadcast log event', () => {
      broadcastLog('wallet-123', {
        id: 'log-001',
        level: 'info',
        module: 'sync',
        message: 'Test log message',
        timestamp: '2024-01-01T00:00:00Z',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'log',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            id: 'log-001',
            level: 'info',
            module: 'sync',
            message: 'Test log message',
          }),
        })
      );
    });

    it('should include details when provided', () => {
      broadcastLog('wallet-123', {
        id: 'log-002',
        level: 'error',
        module: 'electrum',
        message: 'Connection failed',
        timestamp: new Date().toISOString(),
        details: { host: 'electrum.example.com', port: 50002 },
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: { host: 'electrum.example.com', port: 50002 },
          }),
        })
      );
    });
  });

  describe('broadcastBlock', () => {
    it('should broadcast block event', () => {
      broadcastBlock({
        height: 800000,
        hash: 'blockhash123',
        transactionCount: 2500,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'block',
          data: expect.objectContaining({
            height: 800000,
            hash: 'blockhash123',
            transactionCount: 2500,
          }),
        })
      );
    });
  });

  describe('broadcastNewBlock', () => {
    it('should broadcast new block event', () => {
      broadcastNewBlock({
        height: 800001,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'newBlock',
          data: expect.objectContaining({
            height: 800001,
          }),
        })
      );
    });
  });

  describe('broadcastMempool', () => {
    it('should broadcast mempool event', () => {
      broadcastMempool({
        txid: 'mempool-tx-123',
        fee: 5000,
        size: 250,
        feeRate: 20,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mempool',
          data: expect.objectContaining({
            txid: 'mempool-tx-123',
            fee: 5000,
            size: 250,
            feeRate: 20,
          }),
        })
      );
    });
  });

  describe('broadcastModelDownload', () => {
    it('should broadcast model download event', () => {
      broadcastModelDownload({
        model: 'llama2',
        status: 'downloading',
        completed: 450000000,
        total: 1000000000,
        percent: 45,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'modelDownload',
          data: expect.objectContaining({
            model: 'llama2',
            status: 'downloading',
            completed: 450000000,
            total: 1000000000,
            percent: 45,
          }),
        })
      );
    });

    it('should include digest when provided', () => {
      broadcastModelDownload({
        model: 'llama2',
        status: 'verifying',
        completed: 1000000000,
        total: 1000000000,
        percent: 100,
        digest: 'sha256:abc123',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            digest: 'sha256:abc123',
          }),
        })
      );
    });

    it('should include error when status is error', () => {
      broadcastModelDownload({
        model: 'llama2',
        status: 'error',
        completed: 0,
        total: 0,
        percent: 0,
        error: 'Network timeout',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'error',
            error: 'Network timeout',
          }),
        })
      );
    });
  });

  describe('broadcast (generic)', () => {
    it('should broadcast any typed event', () => {
      broadcast({
        type: 'balance',
        walletId: 'wallet-123',
        data: {
          balance: 100000,
          unconfirmed: 0,
          change: 0,
          timestamp: '2024-01-01T00:00:00Z',
        },
      });

      expect(mockBroadcast).toHaveBeenCalled();
    });
  });

  describe('hasWalletSubscribers', () => {
    it('should return true when wallet has subscribers', () => {
      const result = hasWalletSubscribers('123');

      expect(result).toBe(true);
    });

    it('should return false for wallet without subscribers', () => {
      const result = hasWalletSubscribers('999');

      expect(result).toBe(false);
    });
  });

  describe('getBroadcastStats', () => {
    it('should return current stats', () => {
      const stats = getBroadcastStats();

      expect(stats).toEqual({
        connected: true,
        clients: 5,
        channels: ['wallet:123', 'wallet:456', 'blocks'],
        gatewayConnected: false,
      });
    });

    it('should include gateway status', () => {
      mockIsGatewayConnected.mockReturnValueOnce(true);

      const stats = getBroadcastStats();

      expect(stats.gatewayConnected).toBe(true);
    });
  });

  describe('gateway forwarding', () => {
    it('should send to gateway when connected', () => {
      mockIsGatewayConnected.mockReturnValue(true);

      broadcastBalance('wallet-123', {
        balance: 100000,
        unconfirmed: 0,
        change: 0,
      });

      expect(mockSendEvent).toHaveBeenCalled();
    });

    it('should not send to gateway when disconnected', () => {
      mockIsGatewayConnected.mockReturnValue(false);

      broadcastBalance('wallet-123', {
        balance: 100000,
        unconfirmed: 0,
        change: 0,
      });

      expect(mockSendEvent).not.toHaveBeenCalled();
    });
  });
});
