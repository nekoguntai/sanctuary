import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

let scannerScanPayload: { rawValue: string }[] = [{ rawValue: 'ur:crypto-psbt/part' }];
let scannerErrorPayload: unknown = new Error('camera failed');

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: ({
    onScan,
    onError,
  }: {
    onScan: (results: { rawValue: string }[]) => void;
    onError: (err: unknown) => void;
  }) => (
    <div data-testid="scanner">
      <button type="button" onClick={() => onScan(scannerScanPayload)}>
        Emit scan
      </button>
      <button type="button" onClick={() => onError(scannerErrorPayload)}>
        Emit camera error
      </button>
    </div>
  ),
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

function renderModal(onClose = vi.fn(), onSignedPsbt = vi.fn()) {
  render(
    <QRSigningModal
      isOpen={true}
      onClose={onClose}
      psbtBase64="cHNidA=="
      deviceLabel="Passport"
      onSignedPsbt={onSignedPsbt}
    />
  );
  return { onClose, onSignedPsbt };
}

describe('QRSigningModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scannerScanPayload = [{ rawValue: 'ur:crypto-psbt/part' }];
    scannerErrorPayload = new Error('camera failed');
    mockIsUrFormat.mockReturnValue(true);
    mockFeedDecoderPart.mockReturnValue({ complete: true, progress: 100 });
    mockGetDecodedPsbt.mockReturnValue('signed-psbt');
  });

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

  it('advances to scan step and handles a successful UR scan', async () => {
    const user = userEvent.setup();
    const { onClose, onSignedPsbt } = renderModal();

    expect(screen.getByTestId('animated-qr')).toBeInTheDocument();
    await user.click(screen.getByText("I've Signed It"));
    await user.click(screen.getByRole('button', { name: /emit scan/i }));

    expect(mockFeedDecoderPart).toHaveBeenCalled();
    expect(onSignedPsbt).toHaveBeenCalledWith('signed-psbt');
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts raw base64 PSBT scan payloads', async () => {
    const user = userEvent.setup();
    const { onClose, onSignedPsbt } = renderModal();

    mockIsUrFormat.mockReturnValueOnce(false);
    scannerScanPayload = [{ rawValue: 'cHNidA==' }];

    await user.click(screen.getByText("I've Signed It"));
    await user.click(screen.getByRole('button', { name: /emit scan/i }));

    expect(onSignedPsbt).toHaveBeenCalledWith('cHNidA==');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an invalid-format error for non-UR/non-base64 scans', async () => {
    const user = userEvent.setup();
    renderModal();

    mockIsUrFormat.mockReturnValueOnce(false);
    scannerScanPayload = [{ rawValue: 'not-a-psbt' }];

    await user.click(screen.getByText("I've Signed It"));
    await user.click(screen.getByRole('button', { name: /emit scan/i }));

    expect(await screen.findByText(/Invalid QR code format/i)).toBeInTheDocument();
  });

  it('shows decoder error messages when feedDecoderPart reports an error', async () => {
    const user = userEvent.setup();
    renderModal();

    mockFeedDecoderPart.mockReturnValueOnce({
      complete: false,
      progress: 0,
      error: 'invalid ur part',
    });

    await user.click(screen.getByText("I've Signed It"));
    await user.click(screen.getByRole('button', { name: /emit scan/i }));

    expect(await screen.findByText('invalid ur part')).toBeInTheDocument();
  });

  it('displays scan progress when UR decoding is partial', async () => {
    const user = userEvent.setup();
    renderModal();

    mockFeedDecoderPart.mockReturnValueOnce({
      complete: false,
      progress: 42,
    });

    await user.click(screen.getByText("I've Signed It"));
    await user.click(screen.getByRole('button', { name: /emit scan/i }));

    expect(screen.getByText('Scanning...')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('shows decode failure error when complete UR cannot be converted', async () => {
    const user = userEvent.setup();
    const { onSignedPsbt, onClose } = renderModal();

    mockGetDecodedPsbt.mockImplementationOnce(() => {
      throw new Error('decode failed');
    });

    await user.click(screen.getByText("I've Signed It"));
    await user.click(screen.getByRole('button', { name: /emit scan/i }));

    expect(await screen.findByText('decode failed')).toBeInTheDocument();
    expect(onSignedPsbt).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('handles camera errors and allows retrying scanner mode', async () => {
    const user = userEvent.setup();
    renderModal();
    scannerErrorPayload = new Error('Camera blocked');

    await user.click(screen.getByText("I've Signed It"));
    await user.click(screen.getByRole('button', { name: /emit camera error/i }));

    expect(await screen.findByText('Camera blocked')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByTestId('scanner')).toBeInTheDocument();
  });

  it('returns to display step from scan step via back button', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("I've Signed It"));
    expect(screen.getByTestId('scanner')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to qr code/i }));
    expect(screen.getByTestId('animated-qr')).toBeInTheDocument();
  });

  it('closes modal when clicking the close button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    const closeButton = screen.getByTestId('x-icon').closest('button') as HTMLButtonElement;
    await user.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('imports binary PSBT files and emits signed base64', async () => {
    const user = userEvent.setup();
    const { onClose, onSignedPsbt } = renderModal();

    await user.click(screen.getByText("I've Signed It"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    const bytes = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x00]);
    const binary = String.fromCharCode(...bytes);
    const expectedBase64 = btoa(binary);
    const file = new File([bytes], 'signed.psbt', { type: 'application/octet-stream' });

    await user.upload(input, file);

    await waitFor(() => {
      expect(onSignedPsbt).toHaveBeenCalledWith(expectedBase64);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('imports base64 text PSBT files', async () => {
    const user = userEvent.setup();
    const { onClose, onSignedPsbt } = renderModal();

    await user.click(screen.getByText("I've Signed It"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['cHNidA=='], 'signed.txt', { type: 'text/plain' });

    await user.upload(input, file);

    await waitFor(() => {
      expect(onSignedPsbt).toHaveBeenCalledWith('cHNidA==');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('imports hex text PSBT files and converts to base64', async () => {
    const user = userEvent.setup();
    const { onClose, onSignedPsbt } = renderModal();

    await user.click(screen.getByText("I've Signed It"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['70736274ff'], 'signed.txt', { type: 'text/plain' });

    await user.upload(input, file);

    await waitFor(() => {
      expect(onSignedPsbt).toHaveBeenCalledWith('cHNidP8=');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error for invalid uploaded file content', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("I've Signed It"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['invalid-content'], 'signed.txt', { type: 'text/plain' });

    await user.upload(input, file);

    expect(await screen.findByText('Invalid PSBT file format. Expected binary PSBT, base64, or hex.')).toBeInTheDocument();
  });
});
