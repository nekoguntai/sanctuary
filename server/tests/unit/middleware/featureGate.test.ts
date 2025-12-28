/**
 * Feature Gate Middleware Tests
 *
 * Tests for feature flag middleware including top-level and experimental flags.
 */

import { Request, Response, NextFunction } from 'express';
import {
  requireFeature,
  requireAllFeatures,
  requireAnyFeature,
  isFeatureEnabled,
  getEnabledFeatures,
  getFeatureFlagsSummary,
} from '../../../src/middleware/featureGate';

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock config module
const mockFeatures = {
  hardwareWalletSigning: true,
  qrCodeSigning: true,
  multisigWallets: true,
  batchSync: true,
  payjoinSupport: false,
  batchTransactions: true,
  rbfTransactions: true,
  priceAlerts: false,
  aiAssistant: false,
  telegramNotifications: false,
  websocketV2Events: true,
  experimental: {
    taprootAddresses: false,
    silentPayments: false,
    coinJoin: false,
  },
};

jest.mock('../../../src/config', () => ({
  getConfig: () => ({
    features: mockFeatures,
  }),
}));

describe('Feature Gate Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      path: '/test',
      method: 'POST',
    };
    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };
    nextFunction = jest.fn();

    // Reset feature flags to default state
    mockFeatures.hardwareWalletSigning = true;
    mockFeatures.qrCodeSigning = true;
    mockFeatures.multisigWallets = true;
    mockFeatures.batchSync = true;
    mockFeatures.payjoinSupport = false;
    mockFeatures.batchTransactions = true;
    mockFeatures.rbfTransactions = true;
    mockFeatures.priceAlerts = false;
    mockFeatures.aiAssistant = false;
    mockFeatures.telegramNotifications = false;
    mockFeatures.websocketV2Events = true;
    mockFeatures.experimental.taprootAddresses = false;
    mockFeatures.experimental.silentPayments = false;
    mockFeatures.experimental.coinJoin = false;
  });

  describe('requireFeature', () => {
    it('should call next when feature is enabled', () => {
      const middleware = requireFeature('hardwareWalletSigning');

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 when feature is disabled', () => {
      const middleware = requireFeature('payjoinSupport');

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Feature not available',
        feature: 'payjoinSupport',
      }));
    });

    it('should handle experimental features', () => {
      mockFeatures.experimental.taprootAddresses = true;

      const middleware = requireFeature('experimental.taprootAddresses');

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should block disabled experimental features', () => {
      const middleware = requireFeature('experimental.silentPayments');

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });
  });

  describe('requireAllFeatures', () => {
    it('should call next when all features are enabled', () => {
      const middleware = requireAllFeatures([
        'hardwareWalletSigning',
        'qrCodeSigning',
      ]);

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 when any feature is disabled', () => {
      const middleware = requireAllFeatures([
        'hardwareWalletSigning',
        'payjoinSupport', // disabled
      ]);

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Features not available',
        disabledFeatures: ['payjoinSupport'],
      }));
    });

    it('should list all disabled features', () => {
      const middleware = requireAllFeatures([
        'hardwareWalletSigning',
        'payjoinSupport',
        'priceAlerts',
      ]);

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        disabledFeatures: expect.arrayContaining(['payjoinSupport', 'priceAlerts']),
      }));
    });
  });

  describe('requireAnyFeature', () => {
    it('should call next when any feature is enabled', () => {
      const middleware = requireAnyFeature([
        'payjoinSupport', // disabled
        'hardwareWalletSigning', // enabled
      ]);

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 when no features are enabled', () => {
      const middleware = requireAnyFeature([
        'payjoinSupport',
        'priceAlerts',
        'aiAssistant',
      ]);

      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Features not available',
        requiredAnyOf: ['payjoinSupport', 'priceAlerts', 'aiAssistant'],
      }));
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return true for enabled features', () => {
      expect(isFeatureEnabled('hardwareWalletSigning')).toBe(true);
      expect(isFeatureEnabled('qrCodeSigning')).toBe(true);
    });

    it('should return false for disabled features', () => {
      expect(isFeatureEnabled('payjoinSupport')).toBe(false);
      expect(isFeatureEnabled('priceAlerts')).toBe(false);
    });

    it('should handle experimental features', () => {
      mockFeatures.experimental.taprootAddresses = true;
      expect(isFeatureEnabled('experimental.taprootAddresses')).toBe(true);

      expect(isFeatureEnabled('experimental.silentPayments')).toBe(false);
    });
  });

  describe('getEnabledFeatures', () => {
    it('should return list of enabled features', () => {
      const enabled = getEnabledFeatures();

      expect(enabled).toContain('hardwareWalletSigning');
      expect(enabled).toContain('qrCodeSigning');
      expect(enabled).not.toContain('payjoinSupport');
    });

    it('should include enabled experimental features', () => {
      mockFeatures.experimental.taprootAddresses = true;

      const enabled = getEnabledFeatures();

      expect(enabled).toContain('experimental.taprootAddresses');
    });
  });

  describe('getFeatureFlagsSummary', () => {
    it('should return summary of feature flags', () => {
      const summary = getFeatureFlagsSummary();

      expect(summary).toHaveProperty('total');
      expect(summary).toHaveProperty('enabled');
      expect(summary).toHaveProperty('disabled');
      expect(summary).toHaveProperty('experimental');
      expect(summary).toHaveProperty('flags');
    });

    it('should correctly count enabled and disabled features', () => {
      const summary = getFeatureFlagsSummary();

      expect(summary.total).toBeGreaterThan(0);
      expect(summary.enabled + summary.disabled).toBe(summary.total);
    });

    it('should include experimental feature counts', () => {
      const summary = getFeatureFlagsSummary();

      expect(summary.experimental.total).toBe(3); // taprootAddresses, silentPayments, coinJoin
      expect(summary.experimental.enabled).toBe(0); // All disabled by default
    });

    it('should have all flags in the flags object', () => {
      const summary = getFeatureFlagsSummary();

      expect(summary.flags).toHaveProperty('hardwareWalletSigning');
      // Key is a literal string "experimental.taprootAddresses"
      expect('experimental.taprootAddresses' in summary.flags).toBe(true);
    });
  });
});
