import { describe, expect, it } from 'vitest';
import { getDeviceCapabilities } from '../../../../../components/send/steps/review/deviceCapabilities';

describe('deviceCapabilities branch coverage', () => {
  it('covers all special-case branches inside the air-gapped QR condition chain', () => {
    expect(getDeviceCapabilities('passport')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });

    expect(getDeviceCapabilities('foundation')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });

    expect(getDeviceCapabilities('keystone 3 pro')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });

    expect(getDeviceCapabilities('seedsigner')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });
  });
});
