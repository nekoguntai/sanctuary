/**
 * UR-PSBT Utilities
 *
 * Encode and decode PSBTs using Uniform Resources (UR) format
 * for QR code-based signing with air-gapped hardware wallets.
 *
 * Supports:
 * - Foundation Passport (ur:crypto-psbt)
 * - Keystone (ur:crypto-psbt)
 * - SeedSigner (ur:crypto-psbt)
 */

import { CryptoPSBT } from '@keystonehq/bc-ur-registry';
import { UREncoder, URDecoder, UR } from '@ngraveio/bc-ur';
import { createLogger } from './logger';

const log = createLogger('urPsbt');

// Maximum bytes per QR code fragment (lower = smaller QRs, more frames)
const DEFAULT_MAX_FRAGMENT_LENGTH = 100;

/**
 * Encode a base64 PSBT into UR format frames for animated QR display
 *
 * @param psbtBase64 - The PSBT in base64 format
 * @param maxFragmentLength - Maximum bytes per fragment (default: 100)
 * @returns Array of UR strings for each QR frame
 */
export function encodePsbtToUrFrames(
  psbtBase64: string,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH
): string[] {
  try {
    // Convert base64 to Buffer
    const psbtBuffer = Buffer.from(psbtBase64, 'base64');

    log.debug('Encoding PSBT to UR frames', {
      psbtLength: psbtBuffer.length,
      maxFragmentLength
    });

    // Create CryptoPSBT from the buffer
    const cryptoPsbt = new CryptoPSBT(psbtBuffer);

    // Get the CBOR-encoded data
    const cbor = cryptoPsbt.toCBOR();

    // Create UR from the CBOR data with type 'crypto-psbt'
    const ur = new UR(cbor, 'crypto-psbt');

    // Create encoder for fountain codes
    const encoder = new UREncoder(ur, maxFragmentLength);

    // Generate all unique fragments (for single-part, just 1 frame)
    // For fountain codes, we generate more frames than strictly needed
    // to allow recovery from any subset of frames
    const frames: string[] = [];
    const fragmentCount = encoder.fragmentsLength;

    if (fragmentCount === 1) {
      // Single-part encoding - just one frame needed
      frames.push(encoder.nextPart());
    } else {
      // Multi-part fountain encoding
      // Generate 2x the fragment count to ensure good coverage
      const totalFrames = Math.max(fragmentCount * 2, fragmentCount + 4);

      for (let i = 0; i < totalFrames; i++) {
        frames.push(encoder.nextPart());
      }
    }

    log.info('Encoded PSBT to UR frames', {
      frameCount: frames.length,
      fragmentCount,
      firstFrame: frames[0]?.substring(0, 50) + '...'
    });

    return frames;
  } catch (error) {
    log.error('Failed to encode PSBT to UR', { error });
    throw new Error(`Failed to encode PSBT: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the total fragment count for a PSBT (for progress display)
 */
export function getPsbtFragmentCount(
  psbtBase64: string,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH
): number {
  const psbtBuffer = Buffer.from(psbtBase64, 'base64');
  const cryptoPsbt = new CryptoPSBT(psbtBuffer);
  const cbor = cryptoPsbt.toCBOR();
  const ur = new UR(cbor, 'crypto-psbt');
  const encoder = new UREncoder(ur, maxFragmentLength);
  return encoder.fragmentsLength;
}

/**
 * Create a UR decoder for receiving signed PSBT QR codes
 */
export function createPsbtDecoder(): URDecoder {
  return new URDecoder();
}

/**
 * Feed a scanned UR string part to the decoder
 *
 * @returns Object with completion status and progress
 */
export function feedDecoderPart(
  decoder: URDecoder,
  urString: string
): { complete: boolean; progress: number; error?: string } {
  try {
    // Feed the part to the decoder
    decoder.receivePart(urString);

    const progress = Math.round(decoder.estimatedPercentComplete() * 100);
    const isComplete = decoder.isComplete();

    if (decoder.isError()) {
      return {
        complete: false,
        progress,
        error: decoder.resultError() || 'Decoding error'
      };
    }

    return { complete: isComplete, progress };
  } catch (error) {
    return {
      complete: false,
      progress: 0,
      error: error instanceof Error ? error.message : 'Failed to process QR code'
    };
  }
}

/**
 * Get the decoded PSBT from a completed decoder
 *
 * @returns Base64-encoded signed PSBT
 */
export function getDecodedPsbt(decoder: URDecoder): string {
  if (!decoder.isComplete()) {
    throw new Error('Decoder is not complete');
  }

  if (!decoder.isSuccess()) {
    throw new Error(decoder.resultError() || 'Decoding failed');
  }

  try {
    const ur = decoder.resultUR();
    const urType = ur.type.toLowerCase();

    log.debug('Decoding UR result', { type: urType });

    // Handle crypto-psbt type
    if (urType === 'crypto-psbt') {
      // The CBOR payload for crypto-psbt is just the raw PSBT bytes
      // Some libraries wrap it, some don't - try both approaches
      const cborData = ur.decodeCBOR();

      // Check if cborData is already a Buffer/Uint8Array with PSBT magic
      if (cborData instanceof Uint8Array || Buffer.isBuffer(cborData)) {
        const bytes = Buffer.from(cborData);
        // Check for PSBT magic bytes
        if (bytes[0] === 0x70 && bytes[1] === 0x73 &&
            bytes[2] === 0x62 && bytes[3] === 0x74) {
          log.debug('Decoded raw PSBT bytes from crypto-psbt');
          return bytes.toString('base64');
        }
      }

      // Try CryptoPSBT wrapper as fallback
      try {
        const cryptoPsbt = CryptoPSBT.fromCBOR(cborData);
        const psbtBuffer = cryptoPsbt.getPSBT();
        log.debug('Decoded PSBT via CryptoPSBT wrapper');
        return psbtBuffer.toString('base64');
      } catch (wrapperError) {
        log.warn('CryptoPSBT.fromCBOR failed, trying raw extraction', { error: wrapperError });
        // If it's an object with a data property, try that
        if (cborData && typeof cborData === 'object' && 'data' in cborData) {
          const dataBytes = Buffer.from(cborData.data as Uint8Array);
          if (dataBytes[0] === 0x70 && dataBytes[1] === 0x73 &&
              dataBytes[2] === 0x62 && dataBytes[3] === 0x74) {
            return dataBytes.toString('base64');
          }
        }
        throw wrapperError;
      }
    }

    // Handle raw bytes (some devices might use ur:bytes)
    if (urType === 'bytes') {
      const rawBytes = ur.decodeCBOR();
      const bytes = Buffer.from(rawBytes as Uint8Array);
      // Check if it looks like raw PSBT (starts with 'psbt' magic)
      if (bytes[0] === 0x70 && bytes[1] === 0x73 &&
          bytes[2] === 0x62 && bytes[3] === 0x74) {
        return bytes.toString('base64');
      }
      // Otherwise treat as base64-encoded content
      const textDecoder = new TextDecoder('utf-8');
      return textDecoder.decode(bytes);
    }

    throw new Error(`Unsupported UR type: ${urType}`);
  } catch (error) {
    log.error('Failed to decode PSBT from UR', { error });
    throw new Error(`Failed to decode PSBT: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check if a string is a valid UR format
 */
export function isUrFormat(content: string): boolean {
  return content.toLowerCase().startsWith('ur:');
}

/**
 * Extract UR type from a UR string
 */
export function getUrType(urString: string): string | null {
  const match = urString.toLowerCase().match(/^ur:([a-z0-9-]+)/);
  return match ? match[1] : null;
}
