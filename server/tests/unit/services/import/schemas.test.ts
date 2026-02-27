/**
 * Import Zod Schemas Tests
 *
 * Tests for the Zod schemas that validate import formats.
 */

import { describe, it, expect } from 'vitest';
import {
  JsonImportConfigSchema,
  JsonImportDeviceSchema,
  ColdcardExportSchema,
  WalletExportFormatSchema,
  JsonConfigDetectionSchema,
  WalletExportDetectionSchema,
  ColdcardDetectionSchema,
} from '../../../../src/services/import/schemas';

const validDevice = {
  fingerprint: 'aabbccdd',
  derivationPath: "m/84'/0'/0'",
  xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz',
};

describe('Import Schemas', () => {
  describe('JsonImportDeviceSchema', () => {
    it('should accept valid device', () => {
      const result = JsonImportDeviceSchema.safeParse(validDevice);
      expect(result.success).toBe(true);
    });

    it('should reject invalid fingerprint', () => {
      const result = JsonImportDeviceSchema.safeParse({
        ...validDevice,
        fingerprint: 'ZZZZ1234',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing xpub', () => {
      const { xpub, ...noXpub } = validDevice;
      const result = JsonImportDeviceSchema.safeParse(noXpub);
      expect(result.success).toBe(false);
    });

    it('should accept optional type and label', () => {
      const result = JsonImportDeviceSchema.safeParse({
        ...validDevice,
        type: 'coldcard',
        label: 'My Device',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('JsonImportConfigSchema', () => {
    const validSingleSig = {
      type: 'single_sig',
      scriptType: 'native_segwit',
      devices: [validDevice],
    };

    const validMultiSig = {
      type: 'multi_sig',
      scriptType: 'native_segwit',
      quorum: 2,
      devices: [
        validDevice,
        { ...validDevice, fingerprint: '11223344' },
        { ...validDevice, fingerprint: '55667788' },
      ],
    };

    it('should accept valid single-sig config', () => {
      const result = JsonImportConfigSchema.safeParse(validSingleSig);
      expect(result.success).toBe(true);
    });

    it('should accept valid multi-sig config', () => {
      const result = JsonImportConfigSchema.safeParse(validMultiSig);
      expect(result.success).toBe(true);
    });

    it('should reject single-sig with multiple devices', () => {
      const result = JsonImportConfigSchema.safeParse({
        ...validSingleSig,
        devices: [validDevice, { ...validDevice, fingerprint: '11223344' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject multi-sig without quorum', () => {
      const result = JsonImportConfigSchema.safeParse({
        type: 'multi_sig',
        scriptType: 'native_segwit',
        devices: [validDevice, { ...validDevice, fingerprint: '11223344' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject multi-sig with quorum exceeding device count', () => {
      const result = JsonImportConfigSchema.safeParse({
        type: 'multi_sig',
        scriptType: 'native_segwit',
        quorum: 5,
        devices: [validDevice, { ...validDevice, fingerprint: '11223344' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid type', () => {
      const result = JsonImportConfigSchema.safeParse({
        ...validSingleSig,
        type: 'invalid_type',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty devices array', () => {
      const result = JsonImportConfigSchema.safeParse({
        ...validSingleSig,
        devices: [],
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional network and name', () => {
      const result = JsonImportConfigSchema.safeParse({
        ...validSingleSig,
        network: 'testnet',
        name: 'My Wallet',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ColdcardExportSchema', () => {
    const validNestedColdcard = {
      xfp: 'aabbccdd',
      bip84: {
        xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz',
        deriv: "m/84'/0'/0'",
        name: 'p2wpkh',
      },
    };

    const validFlatColdcard = {
      xfp: 'aabbccdd',
      p2wsh: 'Zpub6reSMqNcVU5JJe8HfJkfP2bnP3vNHk1Fm4FU26qBD3ccCe7rfY2qPJv6M6cAqQHx7BqEgJ8SVNa8C7qG56kkSyN5mZFSj8sAZQdPc1Dg3X',
      p2wsh_deriv: "m/48'/0'/0'/2'",
    };

    it('should accept valid nested format', () => {
      const result = ColdcardExportSchema.safeParse(validNestedColdcard);
      expect(result.success).toBe(true);
    });

    it('should accept valid flat format', () => {
      const result = ColdcardExportSchema.safeParse(validFlatColdcard);
      expect(result.success).toBe(true);
    });

    it('should reject missing xfp', () => {
      const { xfp, ...noXfp } = validNestedColdcard;
      const result = ColdcardExportSchema.safeParse(noXfp);
      expect(result.success).toBe(false);
    });

    it('should reject invalid xfp format', () => {
      const result = ColdcardExportSchema.safeParse({
        ...validNestedColdcard,
        xfp: 'ZZZZ',
      });
      expect(result.success).toBe(false);
    });

    it('should reject no BIP paths', () => {
      const result = ColdcardExportSchema.safeParse({
        xfp: 'aabbccdd',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('WalletExportFormatSchema', () => {
    it('should accept valid wallet export', () => {
      const result = WalletExportFormatSchema.safeParse({
        descriptor: 'wpkh([aabbccdd/84h/0h/0h]xpub6.../0/*)',
        label: 'My Wallet',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty descriptor', () => {
      const result = WalletExportFormatSchema.safeParse({
        descriptor: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing descriptor', () => {
      const result = WalletExportFormatSchema.safeParse({
        label: 'My Wallet',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Detection schemas (loose)', () => {
    it('JsonConfigDetectionSchema should detect format with devices + type', () => {
      const result = JsonConfigDetectionSchema.safeParse({
        type: 'single_sig',
        devices: [{ something: true }],
      });
      expect(result.success).toBe(true);
    });

    it('JsonConfigDetectionSchema should detect format with devices + scriptType', () => {
      const result = JsonConfigDetectionSchema.safeParse({
        scriptType: 'native_segwit',
        devices: [{ something: true }],
      });
      expect(result.success).toBe(true);
    });

    it('JsonConfigDetectionSchema should reject without type or scriptType', () => {
      const result = JsonConfigDetectionSchema.safeParse({
        devices: [{ something: true }],
      });
      expect(result.success).toBe(false);
    });

    it('WalletExportDetectionSchema should detect descriptor format', () => {
      const result = WalletExportDetectionSchema.safeParse({
        descriptor: 'wpkh([...]xpub.../0/*)',
      });
      expect(result.success).toBe(true);
    });

    it('ColdcardDetectionSchema should detect valid coldcard', () => {
      const result = ColdcardDetectionSchema.safeParse({
        xfp: 'aabbccdd',
        bip84: { xpub: 'xpub...', deriv: "m/84'/0'/0'" },
      });
      expect(result.success).toBe(true);
    });

    it('ColdcardDetectionSchema should reject invalid xfp', () => {
      const result = ColdcardDetectionSchema.safeParse({
        xfp: 'short',
        bip84: { xpub: 'xpub...', deriv: "m/84'/0'/0'" },
      });
      expect(result.success).toBe(false);
    });
  });
});
