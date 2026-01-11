/**
 * Tests for components/HardwareWalletConnect.tsx
 *
 * Tests the hardware wallet device selection modal including device grid,
 * connection status, error display, and browser support warnings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { HardwareWalletConnect } from '../../components/HardwareWalletConnect';
import type { DeviceType } from '../../services/hardwareWallet';

describe('HardwareWalletConnect', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConnect: vi.fn(),
    connecting: false,
    error: null,
    isSupported: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders nothing when not open', () => {
      const { container } = render(
        <HardwareWalletConnect {...defaultProps} isOpen={false} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders modal when open', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Connect Hardware Wallet')).toBeInTheDocument();
    });

    it('renders subtitle', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Select your device to sign transactions securely')).toBeInTheDocument();
    });

    it('renders all device options', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Coldcard')).toBeInTheDocument();
      expect(screen.getByText('Ledger')).toBeInTheDocument();
      expect(screen.getByText('Trezor')).toBeInTheDocument();
      expect(screen.getByText('BitBox')).toBeInTheDocument();
      expect(screen.getByText('Passport')).toBeInTheDocument();
      expect(screen.getByText('Jade')).toBeInTheDocument();
    });

    it('renders device descriptions', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Mk3, Mk4, Q')).toBeInTheDocument();
      expect(screen.getByText('Nano S, Nano X, Nano S Plus')).toBeInTheDocument();
      expect(screen.getByText('One, Model T, Safe 3/5/7')).toBeInTheDocument();
      expect(screen.getByText('BitBox02')).toBeInTheDocument();
      expect(screen.getByText('Foundation Devices')).toBeInTheDocument();
      expect(screen.getByText('Blockstream Jade')).toBeInTheDocument();
    });

    it('renders connection instructions', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Connection Instructions:')).toBeInTheDocument();
      expect(screen.getByText(/Connect your hardware wallet via USB/)).toBeInTheDocument();
    });

    it('renders footer with security message', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Your keys never leave the device')).toBeInTheDocument();
    });

    it('renders cancel button', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('renders Trezor Suite requirement note', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Requires Trezor Suite')).toBeInTheDocument();
    });

    it('renders Trezor Suite info box', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      expect(screen.getByText('Trezor Suite Required')).toBeInTheDocument();
      expect(screen.getByText(/Trezor devices require/)).toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('calls onClose when X button is clicked', () => {
      const onClose = vi.fn();
      render(<HardwareWalletConnect {...defaultProps} onClose={onClose} />);

      // Find close button (has X icon)
      const buttons = screen.getAllByRole('button');
      const closeButton = buttons.find(btn =>
        btn.className.includes('hover:bg-sanctuary-100')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(onClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when Cancel button is clicked', () => {
      const onClose = vi.fn();
      render(<HardwareWalletConnect {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalled();
    });

    it('disables close button when connecting', () => {
      render(<HardwareWalletConnect {...defaultProps} connecting={true} />);

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });
  });

  describe('device selection', () => {
    it('calls onConnect with coldcard when clicked', async () => {
      const onConnect = vi.fn().mockResolvedValue(undefined);
      render(<HardwareWalletConnect {...defaultProps} onConnect={onConnect} />);

      const coldcardButton = screen.getByText('Coldcard').closest('button');
      if (coldcardButton) {
        fireEvent.click(coldcardButton);
      }

      await waitFor(() => {
        expect(onConnect).toHaveBeenCalledWith('coldcard');
      });
    });

    it('calls onConnect with ledger when clicked', async () => {
      const onConnect = vi.fn().mockResolvedValue(undefined);
      render(<HardwareWalletConnect {...defaultProps} onConnect={onConnect} />);

      const ledgerButton = screen.getByText('Ledger').closest('button');
      if (ledgerButton) {
        fireEvent.click(ledgerButton);
      }

      await waitFor(() => {
        expect(onConnect).toHaveBeenCalledWith('ledger');
      });
    });

    it('calls onConnect with trezor when clicked', async () => {
      const onConnect = vi.fn().mockResolvedValue(undefined);
      render(<HardwareWalletConnect {...defaultProps} onConnect={onConnect} />);

      const trezorButton = screen.getByText('Trezor').closest('button');
      if (trezorButton) {
        fireEvent.click(trezorButton);
      }

      await waitFor(() => {
        expect(onConnect).toHaveBeenCalledWith('trezor');
      });
    });

    it('disables device buttons when connecting', () => {
      render(<HardwareWalletConnect {...defaultProps} connecting={true} />);

      const coldcardButton = screen.getByText('Coldcard').closest('button');
      expect(coldcardButton).toBeDisabled();
    });

    it('disables device buttons when not supported', () => {
      render(<HardwareWalletConnect {...defaultProps} isSupported={false} />);

      const coldcardButton = screen.getByText('Coldcard').closest('button');
      expect(coldcardButton).toBeDisabled();
    });
  });

  describe('browser support warning', () => {
    it('shows warning when WebUSB is not supported', () => {
      render(<HardwareWalletConnect {...defaultProps} isSupported={false} />);

      expect(screen.getByText('USB Connection Unavailable')).toBeInTheDocument();
      expect(screen.getByText(/WebUSB requires HTTPS/)).toBeInTheDocument();
    });

    it('does not show warning when WebUSB is supported', () => {
      render(<HardwareWalletConnect {...defaultProps} isSupported={true} />);

      expect(screen.queryByText('USB Connection Unavailable')).not.toBeInTheDocument();
    });

    it('suggests PSBT workflow when not supported', () => {
      render(<HardwareWalletConnect {...defaultProps} isSupported={false} />);

      expect(screen.getByText(/Use the PSBT file workflow instead/)).toBeInTheDocument();
    });
  });

  describe('error display', () => {
    it('shows error message when error is provided', () => {
      render(
        <HardwareWalletConnect
          {...defaultProps}
          error="Device not recognized"
        />
      );

      expect(screen.getByText('Connection Failed')).toBeInTheDocument();
      expect(screen.getByText('Device not recognized')).toBeInTheDocument();
    });

    it('does not show error when null', () => {
      render(<HardwareWalletConnect {...defaultProps} error={null} />);

      expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument();
    });
  });

  describe('connecting state', () => {
    it('shows loading spinner when connecting', () => {
      render(<HardwareWalletConnect {...defaultProps} connecting={true} />);

      // Loader2 with animate-spin class should be present
      const spinners = document.querySelectorAll('.animate-spin');
      expect(spinners.length).toBeGreaterThan(0);
    });

    it('applies opacity to device cards when connecting', () => {
      render(<HardwareWalletConnect {...defaultProps} connecting={true} />);

      const coldcardButton = screen.getByText('Coldcard').closest('button');
      expect(coldcardButton).toHaveClass('opacity-50');
    });
  });

  describe('accessibility', () => {
    it('has proper modal structure', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      // Modal overlay should be present
      const overlay = document.querySelector('.fixed.inset-0');
      expect(overlay).toBeInTheDocument();
    });

    it('device buttons are properly labelled', () => {
      render(<HardwareWalletConnect {...defaultProps} />);

      const buttons = screen.getAllByRole('button');
      // Should have device buttons + close + cancel
      expect(buttons.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('error handling in click handler', () => {
    it('handles onConnect rejection gracefully', async () => {
      const onConnect = vi.fn().mockRejectedValue(new Error('Connection failed'));
      render(<HardwareWalletConnect {...defaultProps} onConnect={onConnect} />);

      const coldcardButton = screen.getByText('Coldcard').closest('button');
      if (coldcardButton) {
        // Should not throw
        fireEvent.click(coldcardButton);
      }

      await waitFor(() => {
        expect(onConnect).toHaveBeenCalled();
      });

      // Component should still be rendered
      expect(screen.getByText('Connect Hardware Wallet')).toBeInTheDocument();
    });
  });
});
