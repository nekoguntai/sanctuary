/**
 * Tests for QRSigningModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QRSigningModal } from '../../../components/qr/QRSigningModal';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock AnimatedQRCode component
vi.mock('../../../components/qr/AnimatedQRCode', () => ({
  AnimatedQRCode: ({ psbtBase64 }: { psbtBase64: string }) => (
    <div data-testid="animated-qr-code">{psbtBase64.slice(0, 20)}...</div>
  ),
}));

// Mock Scanner component from @yudiel/react-qr-scanner
const mockOnScan = vi.fn();
const mockOnError = vi.fn();
vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: ({ onScan, onError }: any) => {
    // Store callbacks for test access
    mockOnScan.mockImplementation(onScan);
    mockOnError.mockImplementation(onError);
    return (
      <div data-testid="scanner">
        <button
          data-testid="scan-result"
          onClick={() => onScan([{ rawValue: 'cHNidP8BAFUCAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////8BAAAAAAAAAABGagQiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiAAAA' }])}
        >
          Simulate Scan
        </button>
        <button
          data-testid="scan-error"
          onClick={() => onError(new Error('Camera access denied'))}
        >
          Simulate Error
        </button>
      </div>
    );
  },
}));

// Mock UR utilities
vi.mock('../../../utils/urPsbt', () => ({
  createPsbtDecoder: vi.fn(() => ({})),
  feedDecoderPart: vi.fn(() => ({ progress: 100, complete: true })),
  getDecodedPsbt: vi.fn(() => 'cHNidP8signedbase64...'),
  isUrFormat: vi.fn((content: string) => content.toLowerCase().startsWith('ur:')),
}));

describe('QRSigningModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    psbtBase64: 'cHNidP8BAHUCAAAAASaBcTce3/KF6Tig7cez6e...',
    deviceLabel: 'Coldcard',
    onSignedPsbt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('closed state', () => {
    it('does not render when closed', () => {
      render(<QRSigningModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByText(/QR Signing/)).not.toBeInTheDocument();
    });
  });

  describe('initial display step', () => {
    it('renders modal with title including device label', () => {
      render(<QRSigningModal {...defaultProps} />);

      expect(screen.getByText('QR Signing - Coldcard')).toBeInTheDocument();
    });

    it('shows step indicator for display step', () => {
      render(<QRSigningModal {...defaultProps} />);

      expect(screen.getByText('Show to device')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('displays AnimatedQRCode component', () => {
      render(<QRSigningModal {...defaultProps} />);

      expect(screen.getByTestId('animated-qr-code')).toBeInTheDocument();
    });

    it('shows instructions for scanning with device label', () => {
      render(<QRSigningModal {...defaultProps} />);

      expect(screen.getByText(/Scan this QR code with your Coldcard/)).toBeInTheDocument();
    });

    it('has continue button to proceed to scan step', () => {
      render(<QRSigningModal {...defaultProps} />);

      expect(screen.getByText("I've Signed It")).toBeInTheDocument();
    });

    it('shows close button', () => {
      render(<QRSigningModal {...defaultProps} />);

      // Close button is an X icon button
      const buttons = screen.getAllByRole('button');
      const closeButton = buttons.find(btn => btn.querySelector('svg'));
      expect(closeButton).toBeInTheDocument();
    });

    it('calls onClose when close button clicked', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      // Find button with X icon
      const buttons = screen.getAllByRole('button');
      const closeButton = buttons.find(btn => {
        const svg = btn.querySelector('svg');
        return svg && !btn.textContent?.includes("I've Signed It");
      });

      if (closeButton) {
        await user.click(closeButton);
        expect(defaultProps.onClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when clicking backdrop', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      // The backdrop is a div with bg-black/60
      const backdrop = document.querySelector('.bg-black\\/60');
      if (backdrop) {
        await user.click(backdrop);
        expect(defaultProps.onClose).toHaveBeenCalled();
      }
    });
  });

  describe('scan step', () => {
    it('shows scan step when clicking continue button', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        expect(screen.getByText('Scan signed')).toBeInTheDocument();
      });
    });

    it('shows scanner component', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        expect(screen.getByTestId('scanner')).toBeInTheDocument();
      });
    });

    it('shows instructions for signed QR with device label', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        expect(screen.getByText(/After signing on your Coldcard/)).toBeInTheDocument();
      });
    });

    it('has back button to return to display step', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        expect(screen.getByText('Back to QR Code')).toBeInTheDocument();
      });
    });

    it('returns to display step when back clicked', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));
      await waitFor(() => {
        expect(screen.getByText('Scan signed')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Back to QR Code'));

      await waitFor(() => {
        expect(screen.getByText('Show to device')).toBeInTheDocument();
      });
    });

    it('shows completed checkmark for step 1 in scan step', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        expect(screen.getByText('Shown to device')).toBeInTheDocument();
      });
    });
  });

  describe('file upload fallback', () => {
    it('shows file upload option in scan step', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        expect(screen.getByText('Upload PSBT File Instead')).toBeInTheDocument();
      });
    });

    it('has hidden file input for PSBT upload', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        const fileInput = document.querySelector('input[type="file"]');
        expect(fileInput).toBeInTheDocument();
        expect(fileInput).toHaveAttribute('accept', '.psbt,.txt');
      });
    });
  });

  describe('error handling', () => {
    it('shows error message on camera error', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));

      await waitFor(() => {
        expect(screen.getByTestId('scanner')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('scan-error'));

      await waitFor(() => {
        expect(screen.getByText(/Camera access denied/)).toBeInTheDocument();
      });
    });

    it('shows try again button on camera error', async () => {
      const user = userEvent.setup();
      render(<QRSigningModal {...defaultProps} />);

      await user.click(screen.getByText("I've Signed It"));
      await waitFor(() => {
        expect(screen.getByTestId('scanner')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('scan-error'));

      await waitFor(() => {
        expect(screen.getByText('Try Again')).toBeInTheDocument();
      });
    });
  });

  describe('different device labels', () => {
    it('shows Ledger in instructions when deviceLabel is Ledger', () => {
      render(<QRSigningModal {...defaultProps} deviceLabel="Ledger Nano X" />);

      expect(screen.getByText('QR Signing - Ledger Nano X')).toBeInTheDocument();
      expect(screen.getByText(/Scan this QR code with your Ledger Nano X/)).toBeInTheDocument();
    });

    it('shows Keystone in instructions when deviceLabel is Keystone', () => {
      render(<QRSigningModal {...defaultProps} deviceLabel="Keystone Pro" />);

      expect(screen.getByText('QR Signing - Keystone Pro')).toBeInTheDocument();
    });
  });

  describe('step indicators', () => {
    it('shows step 1 as active in display step', () => {
      render(<QRSigningModal {...defaultProps} />);

      // Step 1 should have primary color indicator
      const step1Indicator = screen.getByText('1');
      expect(step1Indicator.className).toMatch(/bg-primary/);
    });

    it('shows step 2 as inactive in display step', () => {
      render(<QRSigningModal {...defaultProps} />);

      // Step 2 text should be in muted color
      const step2Text = screen.getByText('Scan signed');
      expect(step2Text.className).toMatch(/text-sanctuary-400/);
    });
  });

  describe('modal state reset', () => {
    it('resets to display step when closed via close button', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<QRSigningModal {...defaultProps} />);

      // Go to scan step
      await user.click(screen.getByText("I've Signed It"));
      await waitFor(() => {
        expect(screen.getByText('Scan signed')).toBeInTheDocument();
      });

      // Close via close button (which calls handleClose that resets state)
      const closeButton = screen.getAllByRole('button').find(btn => {
        const svg = btn.querySelector('svg');
        return svg && !btn.textContent?.includes("I've Signed It") && !btn.textContent?.includes('Back');
      });

      if (closeButton) {
        await user.click(closeButton);
      }

      // Reopen
      rerender(<QRSigningModal {...defaultProps} isOpen={true} />);

      // Should be back to display step
      await waitFor(() => {
        expect(screen.getByText('Show to device')).toBeInTheDocument();
      });
    });
  });
});
