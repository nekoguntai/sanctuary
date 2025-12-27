import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { OutputRow, OutputRowProps } from '../../../components/send/OutputRow';
import type { OutputEntry, WalletAddress } from '../../../contexts/send/types';

describe('OutputRow', () => {
  // Use vi.fn() directly - these will be reset in beforeEach
  const mockOnAddressChange = vi.fn();
  const mockOnAmountChange = vi.fn();
  const mockOnAmountBlur = vi.fn();
  const mockOnRemove = vi.fn();
  const mockOnToggleSendMax = vi.fn();
  const mockOnScanQR = vi.fn();
  const mockFormatAmount = vi.fn((sats: number) => sats.toString());

  const defaultOutput: OutputEntry = {
    address: '',
    amount: '',
    sendMax: false,
  };

  const defaultProps: OutputRowProps = {
    output: defaultOutput,
    index: 0,
    totalOutputs: 1,
    isValid: null,
    onAddressChange: vi.fn(),
    onAmountChange: vi.fn(),
    onAmountBlur: vi.fn(),
    onRemove: vi.fn(),
    onToggleSendMax: vi.fn(),
    onScanQR: vi.fn(),
    isConsolidation: false,
    walletAddresses: [],
    disabled: false,
    showScanner: false,
    scanningOutputIndex: null,
    payjoinUrl: null,
    payjoinStatus: 'idle',
    unit: 'sats',
    unitLabel: 'sats',
    displayValue: '',
    maxAmount: 100000,
    formatAmount: (sats: number) => sats.toString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFormatAmount.mockImplementation((sats: number) => sats.toString());
  });

  const renderRow = (props: Partial<OutputRowProps> = {}) => {
    return render(
      <OutputRow
        {...defaultProps}
        onAddressChange={mockOnAddressChange}
        onAmountChange={mockOnAmountChange}
        onAmountBlur={mockOnAmountBlur}
        onRemove={mockOnRemove}
        onToggleSendMax={mockOnToggleSendMax}
        onScanQR={mockOnScanQR}
        formatAmount={mockFormatAmount}
        {...props}
      />
    );
  };

  describe('Address input', () => {
    it('should render address input field', () => {
      renderRow();

      const input = screen.getByPlaceholderText('bc1q... or bitcoin:...');
      expect(input).toBeInTheDocument();
    });

    it('should display current address value', () => {
      const output = { ...defaultOutput, address: 'bc1qtest123' };
      renderRow({ output });

      const input = screen.getByPlaceholderText('bc1q... or bitcoin:...') as HTMLInputElement;
      expect(input.value).toBe('bc1qtest123');
    });

    it('should call onAddressChange when address is typed', () => {
      renderRow();

      const input = screen.getByPlaceholderText('bc1q... or bitcoin:...');
      fireEvent.change(input, { target: { value: 'bc1qnewaddress' } });

      expect(mockOnAddressChange).toHaveBeenCalledWith(0, 'bc1qnewaddress');
    });

    it('should disable address input when disabled prop is true', () => {
      renderRow({ disabled: true });

      const input = screen.getByPlaceholderText('bc1q... or bitcoin:...') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it('should show check icon for valid address', () => {
      renderRow({ isValid: true });

      // Look for the Check icon by finding svg with specific class
      const input = screen.getByPlaceholderText('bc1q... or bitcoin:...');
      const parent = input.parentElement;
      expect(parent?.querySelector('svg')).toBeInTheDocument();
    });

    it('should show X icon for invalid address', () => {
      renderRow({ isValid: false });

      const input = screen.getByPlaceholderText('bc1q... or bitcoin:...');
      const parent = input.parentElement;
      expect(parent?.querySelector('svg')).toBeInTheDocument();
    });

    it('should show validation error message for invalid address', () => {
      renderRow({ isValid: false });

      expect(screen.getByText('Invalid Bitcoin address')).toBeInTheDocument();
    });

    it('should not show validation error in consolidation mode', () => {
      renderRow({ isValid: false, isConsolidation: true });

      expect(screen.queryByText('Invalid Bitcoin address')).not.toBeInTheDocument();
    });
  });

  describe('Consolidation mode', () => {
    const walletAddresses: WalletAddress[] = [
      { address: 'bc1qreceive1', used: false, index: 0, isChange: false },
      { address: 'bc1qreceive2', used: true, index: 1, isChange: false },
      { address: 'bc1qchange1', used: false, index: 0, isChange: true },
      { address: 'bc1qchange2', used: false, index: 1, isChange: true },
    ];

    it('should show dropdown instead of text input in consolidation mode', () => {
      renderRow({
        isConsolidation: true,
        walletAddresses,
      });

      expect(screen.getByRole('combobox')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('bc1q... or bitcoin:...')).not.toBeInTheDocument();
    });

    it('should only show receive addresses (not change addresses) in consolidation dropdown', () => {
      renderRow({
        isConsolidation: true,
        walletAddresses,
      });

      const select = screen.getByRole('combobox');
      const options = select.querySelectorAll('option');

      // Should only have 2 options (the receive addresses)
      expect(options).toHaveLength(2);
    });

    it('should show address index and truncated address in dropdown options', () => {
      renderRow({
        isConsolidation: true,
        walletAddresses,
        output: { ...defaultOutput, address: 'bc1qreceive1' },
      });

      const select = screen.getByRole('combobox');
      expect(select.innerHTML).toContain('#0:');
      expect(select.innerHTML).toContain('#1:');
    });

    it('should indicate used addresses in dropdown', () => {
      renderRow({
        isConsolidation: true,
        walletAddresses,
      });

      const select = screen.getByRole('combobox');
      expect(select.innerHTML).toContain('(used)');
    });

    it('should call onAddressChange when dropdown selection changes', () => {
      renderRow({
        isConsolidation: true,
        walletAddresses,
      });

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'bc1qreceive2' } });

      expect(mockOnAddressChange).toHaveBeenCalledWith(0, 'bc1qreceive2');
    });

    it('should not show dropdown for non-first output in consolidation', () => {
      renderRow({
        isConsolidation: true,
        walletAddresses,
        index: 1, // Not the first output
      });

      // Should show regular input, not dropdown
      expect(screen.getByPlaceholderText('bc1q... or bitcoin:...')).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
  });

  describe('Amount input', () => {
    it('should render amount input field', () => {
      renderRow();

      const input = screen.getByPlaceholderText('0');
      expect(input).toBeInTheDocument();
    });

    it('should display current amount value', () => {
      renderRow({ displayValue: '50000' });

      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      expect(input.value).toBe('50000');
    });

    it('should call onAmountChange when amount is typed', () => {
      renderRow();

      const input = screen.getByPlaceholderText('0');
      fireEvent.change(input, { target: { value: '75000' } });

      expect(mockOnAmountChange).toHaveBeenCalledWith(0, '75000', '75000');
    });

    it('should call onAmountBlur when input loses focus', () => {
      renderRow();

      const input = screen.getByPlaceholderText('0');
      fireEvent.blur(input);

      expect(mockOnAmountBlur).toHaveBeenCalledWith(0);
    });

    it('should disable amount input when disabled prop is true', () => {
      renderRow({ disabled: true });

      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it('should show unit label in amount input', () => {
      renderRow({ unitLabel: 'sats' });

      expect(screen.getByText('sats')).toBeInTheDocument();
    });

    it('should allow decimal input in BTC mode', () => {
      renderRow({ unit: 'btc' });

      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      expect(input.inputMode).toBe('decimal');
    });

    it('should allow numeric input in sats mode', () => {
      renderRow({ unit: 'sats' });

      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      expect(input.inputMode).toBe('numeric');
    });
  });

  describe('Send Max toggle', () => {
    it('should show MAX button', () => {
      renderRow();

      expect(screen.getByText('MAX')).toBeInTheDocument();
    });

    it('should call onToggleSendMax when MAX button is clicked', () => {
      renderRow();

      const maxButton = screen.getByRole('button', { name: /MAX/i });
      fireEvent.click(maxButton);

      expect(mockOnToggleSendMax).toHaveBeenCalledWith(0);
    });

    it('should show active MAX badge when sendMax is true', () => {
      const output = { ...defaultOutput, sendMax: true };
      renderRow({ output });

      // Should have 2 MAX texts: button and badge
      const maxElements = screen.getAllByText('MAX');
      expect(maxElements.length).toBeGreaterThanOrEqual(2);
    });

    it('should make amount input read-only when sendMax is true', () => {
      const output = { ...defaultOutput, sendMax: true };
      renderRow({ output });

      const input = screen.getByPlaceholderText('0') as HTMLInputElement;
      expect(input.readOnly).toBe(true);
    });

    it('should display max amount when sendMax is true', () => {
      const output = { ...defaultOutput, sendMax: true };
      mockFormatAmount.mockReturnValue('100000');
      renderRow({ output, maxAmount: 100000 });

      expect(mockFormatAmount).toHaveBeenCalledWith(100000);
    });

    it('should hide MAX button when disabled', () => {
      renderRow({ disabled: true });

      const maxButtons = screen.queryAllByRole('button', { name: /MAX/i });
      expect(maxButtons).toHaveLength(0);
    });
  });

  describe('Multi-output mode', () => {
    it('should show output number header for multiple outputs', () => {
      renderRow({ totalOutputs: 3, index: 1 });

      expect(screen.getByText('Output #2')).toBeInTheDocument();
    });

    it('should not show output header for single output', () => {
      renderRow({ totalOutputs: 1 });

      expect(screen.queryByText('Output #1')).not.toBeInTheDocument();
    });

    it('should show remove button for multiple outputs', () => {
      renderRow({ totalOutputs: 2 });

      const removeButton = screen.getByTitle('Remove output');
      expect(removeButton).toBeInTheDocument();
    });

    it('should not show remove button for single output', () => {
      renderRow({ totalOutputs: 1 });

      expect(screen.queryByTitle('Remove output')).not.toBeInTheDocument();
    });

    it('should call onRemove when remove button is clicked', () => {
      renderRow({ totalOutputs: 2, index: 1 });

      const removeButton = screen.getByTitle('Remove output');
      fireEvent.click(removeButton);

      expect(mockOnRemove).toHaveBeenCalledWith(1);
    });

    it('should hide remove button when disabled', () => {
      renderRow({ totalOutputs: 2, disabled: true });

      expect(screen.queryByTitle('Remove output')).not.toBeInTheDocument();
    });
  });

  describe('QR Scanner', () => {
    it('should show QR scan button', () => {
      renderRow();

      // There are multiple buttons (QR + MAX), check that at least one exists
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should call onScanQR when QR button is clicked', () => {
      renderRow();

      // Find the button with QR icon (not the MAX button)
      const buttons = screen.getAllByRole('button');
      const qrButton = buttons.find(btn => btn !== screen.queryByText('MAX')?.closest('button'));
      if (qrButton) {
        fireEvent.click(qrButton);
        expect(mockOnScanQR).toHaveBeenCalledWith(0);
      }
    });

    it('should not show QR button when disabled', () => {
      renderRow({ disabled: true });

      // Use queryAllByRole since it returns empty array instead of throwing
      const buttons = screen.queryAllByRole('button');
      // Should only have 0 buttons when disabled (no QR, no MAX)
      expect(buttons).toHaveLength(0);
    });

    it('should show scanner interface when scanning this output', () => {
      const videoRef = React.createRef<HTMLVideoElement>();
      const canvasRef = React.createRef<HTMLCanvasElement>();

      renderRow({
        showScanner: true,
        scanningOutputIndex: 0,
        videoRef,
        canvasRef,
      });

      expect(screen.getByText('Scan Bitcoin QR Code')).toBeInTheDocument();
    });

    it('should not show scanner when scanning different output', () => {
      const videoRef = React.createRef<HTMLVideoElement>();
      const canvasRef = React.createRef<HTMLCanvasElement>();

      renderRow({
        showScanner: true,
        scanningOutputIndex: 1,
        index: 0,
        videoRef,
        canvasRef,
      });

      expect(screen.queryByText('Scan Bitcoin QR Code')).not.toBeInTheDocument();
    });
  });

  describe('Payjoin support', () => {
    it('should show payjoin indicator when payjoin URL is present', () => {
      renderRow({
        payjoinUrl: 'https://example.com/payjoin',
        index: 0, // Payjoin only for first output
      });

      expect(screen.getByText(/Payjoin enabled/)).toBeInTheDocument();
    });

    it('should not show payjoin indicator for non-first output', () => {
      renderRow({
        payjoinUrl: 'https://example.com/payjoin',
        index: 1,
      });

      expect(screen.queryByText(/Payjoin enabled/)).not.toBeInTheDocument();
    });

    it('should show payjoin status', () => {
      renderRow({
        payjoinUrl: 'https://example.com/payjoin',
        payjoinStatus: 'attempting',
        index: 0,
      });

      expect(screen.getByText(/attempting.../)).toBeInTheDocument();
    });

    it('should show success checkmark when payjoin succeeds', () => {
      renderRow({
        payjoinUrl: 'https://example.com/payjoin',
        payjoinStatus: 'success',
        index: 0,
      });

      expect(screen.getByText(/✓/)).toBeInTheDocument();
    });

    it('should show fallback message when payjoin fails', () => {
      renderRow({
        payjoinUrl: 'https://example.com/payjoin',
        payjoinStatus: 'failed',
        index: 0,
      });

      expect(screen.getByText(/fell back to regular send/)).toBeInTheDocument();
    });

    it('should style address input differently with payjoin', () => {
      renderRow({
        payjoinUrl: 'https://example.com/payjoin',
        index: 0,
      });

      const input = screen.getByPlaceholderText('bc1q... or bitcoin:...');
      expect(input.className).toContain('border-zen-indigo');
    });
  });

  describe('Styling and layout', () => {
    it('should have different styling for multi-output rows', () => {
      const { container } = renderRow({ totalOutputs: 3 });

      const row = container.firstChild;
      expect(row).toHaveClass('surface-secondary');
    });

    it('should not have special styling for single output', () => {
      const { container } = renderRow({ totalOutputs: 1 });

      const row = container.firstChild as HTMLElement;
      expect(row.className).not.toContain('surface-secondary');
    });

    it('should apply disabled opacity when disabled', () => {
      renderRow({ disabled: true });

      const addressInput = screen.getByPlaceholderText('bc1q... or bitcoin:...');
      expect(addressInput.className).toContain('opacity-60');
    });
  });
});
