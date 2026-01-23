import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QRSigningModal } from '../../../components/qr/QRSigningModal';

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon" />,
  QrCode: () => <span data-testid="qr-icon" />,
  Camera: () => <span data-testid="camera-icon" />,
  ArrowRight: () => <span data-testid="arrow-right" />,
  ArrowLeft: () => <span data-testid="arrow-left" />,
  Upload: () => <span data-testid="upload-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
}));

vi.mock('../../../components/qr/AnimatedQRCode', () => ({
  AnimatedQRCode: () => <div data-testid="animated-qr" />,
}));

const mockOnScan = vi.fn();
const mockOnError = vi.fn();

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: ({ onScan, onError }: { onScan: (results: { rawValue: string }[]) => void; onError: (err: unknown) => void }) => {
    mockOnScan.mockImplementation(onScan);
    mockOnError.mockImplementation(onError);
    return <button type="button" onClick={() => onScan([{ rawValue: 'ur:crypto-psbt/part' }])}>scan</button>;
  },
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockCreateDecoder = vi.fn(() => ({
  isComplete: () => true,
  isSuccess: () => true,
}));

const mockFeedDecoderPart = vi.fn(() => ({ complete: true, progress: 100 }));
const mockGetDecodedPsbt = vi.fn(() => 'signed-psbt');
const mockIsUrFormat = vi.fn(() => true);

vi.mock('../../../utils/urPsbt', () => ({
  createPsbtDecoder: () => mockCreateDecoder(),
  feedDecoderPart: (...args: unknown[]) => mockFeedDecoderPart(...args),
  getDecodedPsbt: () => mockGetDecodedPsbt(),
  isUrFormat: (content: string) => mockIsUrFormat(content),
}));

describe('QRSigningModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <QRSigningModal
        isOpen={false}
        onClose={vi.fn()}
        psbtBase64="cHNidA=="
        deviceLabel="Passport"
        onSignedPsbt={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('advances to scan step and handles UR scan', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSignedPsbt = vi.fn();

    render(
      <QRSigningModal
        isOpen={true}
        onClose={onClose}
        psbtBase64="cHNidA=="
        deviceLabel="Passport"
        onSignedPsbt={onSignedPsbt}
      />
    );

    expect(screen.getByTestId('animated-qr')).toBeInTheDocument();
    await user.click(screen.getByText("I've Signed It"));

    await user.click(screen.getByText('scan'));
    expect(mockFeedDecoderPart).toHaveBeenCalled();
    expect(onSignedPsbt).toHaveBeenCalledWith('signed-psbt');
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts raw base64 PSBT scans', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSignedPsbt = vi.fn();

    mockIsUrFormat.mockReturnValueOnce(false);

    render(
      <QRSigningModal
        isOpen={true}
        onClose={onClose}
        psbtBase64="cHNidA=="
        deviceLabel="Passport"
        onSignedPsbt={onSignedPsbt}
      />
    );

    await user.click(screen.getByText("I've Signed It"));

    mockOnScan([{ rawValue: 'cHNidA==' }]);

    expect(onSignedPsbt).toHaveBeenCalledWith('cHNidA==');
    expect(onClose).toHaveBeenCalled();
  });
});
