import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { signPsbtWithTrezor } from '../../../services/hardwareWallet/adapters/trezor/signPsbt';

const {
  mockSignTransaction,
  mockGetTrezorScriptType,
  mockPathToAddressN,
  mockValidateSatoshiAmount,
  mockBuildTrezorMultisig,
  mockIsMultisigInput,
  mockFetchRefTxs,
  mockLoggerError,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockSignTransaction: vi.fn(),
  mockGetTrezorScriptType: vi.fn(),
  mockPathToAddressN: vi.fn(),
  mockValidateSatoshiAmount: vi.fn(),
  mockBuildTrezorMultisig: vi.fn(),
  mockIsMultisigInput: vi.fn(),
  mockFetchRefTxs: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@trezor/connect-web', () => ({
  default: {
    signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  },
}));

vi.mock('../../../services/hardwareWallet/adapters/trezor/pathUtils', () => ({
  getTrezorScriptType: (...args: unknown[]) => mockGetTrezorScriptType(...args),
  pathToAddressN: (...args: unknown[]) => mockPathToAddressN(...args),
  validateSatoshiAmount: (...args: unknown[]) => mockValidateSatoshiAmount(...args),
}));

vi.mock('../../../services/hardwareWallet/adapters/trezor/multisig', () => ({
  buildTrezorMultisig: (...args: unknown[]) => mockBuildTrezorMultisig(...args),
  isMultisigInput: (...args: unknown[]) => mockIsMultisigInput(...args),
}));

vi.mock('../../../services/hardwareWallet/adapters/trezor/refTxs', () => ({
  fetchRefTxs: (...args: unknown[]) => mockFetchRefTxs(...args),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  }),
}));

function createPsbt({
  includeInputDerivation = true,
  includeWitnessUtxo = true,
  includeChangeDerivation = true,
}: {
  includeInputDerivation?: boolean;
  includeWitnessUtxo?: boolean;
  includeChangeDerivation?: boolean;
} = {}) {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  const inputPubkey = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
  const inputScript = Buffer.from(`0014${'11'.repeat(20)}`, 'hex');

  const input: any = {
    hash: 'aa'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
  };

  if (includeWitnessUtxo) {
    input.witnessUtxo = {
      script: inputScript,
      value: 50_000,
    };
  }

  if (includeInputDerivation) {
    input.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/49'/0'/0'/0/0",
        pubkey: inputPubkey,
      },
    ];
  }

  psbt.addInput(input);

  psbt.addOutput({
    script: Buffer.from(`0014${'22'.repeat(20)}`, 'hex'),
    value: 40_000,
  });

  const changeOutput: any = {
    script: Buffer.from(`0014${'33'.repeat(20)}`, 'hex'),
    value: 9_000,
  };
  if (includeChangeDerivation) {
    changeOutput.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/49'/0'/0'/1/0",
        pubkey: inputPubkey,
      },
    ];
  }
  psbt.addOutput(changeOutput);

  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  const signedTxHex = bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer()).toHex();
  return { psbt, signedTxHex };
}

describe('signPsbtWithTrezor branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathToAddressN.mockReturnValue([1, 2, 3]);
    mockValidateSatoshiAmount.mockImplementation((amount: number | bigint) => String(amount));
    mockGetTrezorScriptType.mockReturnValue('SPENDWITNESS');
    mockBuildTrezorMultisig.mockReturnValue(undefined);
    mockIsMultisigInput.mockReturnValue(false);
    mockFetchRefTxs.mockResolvedValue([]);
  });

  it('uses mainnet request path detection and maps change output to PAYTOP2SHWITNESS', async () => {
    const { psbt, signedTxHex } = createPsbt();
    mockGetTrezorScriptType.mockReturnValue('SPENDP2SHWITNESS');
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/49'/0'/0'",
        inputPaths: [],
      },
      { fingerprint: undefined } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.coin).toBe('Bitcoin');
    expect(call.outputs[1].script_type).toBe('PAYTOP2SHWITNESS');
  });

  it('falls back to request.inputPaths when input bip32 derivation is missing', async () => {
    const { psbt, signedTxHex } = createPsbt({ includeInputDerivation: false });
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/7"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockPathToAddressN).toHaveBeenCalledWith("m/84'/0'/0'/0/7");
  });

  it('maps change output to PAYTOTAPROOT and includes multisig output payload when built', async () => {
    const { psbt, signedTxHex } = createPsbt();
    mockGetTrezorScriptType.mockReturnValue('SPENDTAPROOT');
    mockBuildTrezorMultisig.mockReturnValue({
      m: 2,
      pubkeys: [],
      signatures: [],
    });

    const output = psbt.data.outputs[1] as any;
    output.witnessScript = Buffer.from('512102' + '11'.repeat(32) + '51ae', 'hex');
    output.bip32Derivation = [
      {
        masterFingerprint: Buffer.from('deadbeef', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
      },
      {
        masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
        path: "m/86'/0'/0'/1/0",
        pubkey: Buffer.from(`03${'22'.repeat(32)}`, 'hex'),
      },
    ];

    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        accountPath: "m/86'/0'/0'",
        inputPaths: ["m/86'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    const call = mockSignTransaction.mock.calls.at(-1)?.[0];
    expect(call.outputs[1].script_type).toBe('PAYTOTAPROOT');
    expect(call.outputs[1].multisig).toBeDefined();
  });

  it('logs mismatched witness amount against fetched ref transaction output', async () => {
    const { psbt, signedTxHex } = createPsbt();
    const txid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex');
    mockFetchRefTxs.mockResolvedValueOnce([
      {
        hash: txid,
        bin_outputs: [{ amount: '999999' }],
      },
    ]);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Input amount mismatch between PSBT and reference transaction',
      expect.any(Object)
    );
  });

  it('continues when multisig signature extraction throws in nested try/catch', async () => {
    const { psbt, signedTxHex } = createPsbt();
    (psbt.data.inputs[0] as any).witnessScript = Buffer.from('5221' + '11'.repeat(33) + '51ae', 'hex');
    mockIsMultisigInput.mockReturnValue(true);
    mockSignTransaction.mockResolvedValueOnce({
      success: true,
      payload: { serializedTx: signedTxHex },
    });

    const originalFromHex = bitcoin.Transaction.fromHex.bind(bitcoin.Transaction);
    const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex');
    fromHexSpy.mockImplementationOnce((hex: string) => originalFromHex(hex));
    fromHexSpy.mockImplementationOnce(() => {
      throw new Error('extract failure');
    });

    const response = await signPsbtWithTrezor(
      {
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      },
      { fingerprint: 'deadbeef' } as any
    );

    expect(response.rawTx).toBe(signedTxHex);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to extract signatures from Trezor rawTx',
      expect.any(Object)
    );

    fromHexSpy.mockRestore();
  });

  it('wraps non-Error throwables as unknown signing failures', async () => {
    const { psbt } = createPsbt({ includeWitnessUtxo: false });
    mockSignTransaction.mockRejectedValueOnce('boom');

    await expect(
      signPsbtWithTrezor(
        {
          psbt: psbt.toBase64(),
          inputPaths: ["m/84'/0'/0'/0/0"],
        },
        { fingerprint: 'deadbeef' } as any
      )
    ).rejects.toThrow('Failed to sign with Trezor: Unknown error');
  });
});
