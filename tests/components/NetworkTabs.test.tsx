import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { NetworkTabs, TabNetwork } from '../../components/NetworkTabs';

describe('NetworkTabs', () => {
  const mockOnNetworkChange = vi.fn();

  const defaultProps = {
    selectedNetwork: 'mainnet' as TabNetwork,
    onNetworkChange: mockOnNetworkChange,
    walletCounts: {
      mainnet: 3,
      testnet: 2,
      signet: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render all three network tabs', () => {
      render(<NetworkTabs {...defaultProps} />);

      expect(screen.getByText('Mainnet')).toBeInTheDocument();
      expect(screen.getByText('Testnet')).toBeInTheDocument();
      expect(screen.getByText('Signet')).toBeInTheDocument();
    });

    it('should display wallet counts for each network', () => {
      render(<NetworkTabs {...defaultProps} />);

      // Each count appears next to its network label
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <NetworkTabs {...defaultProps} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Selection', () => {
    it('should visually highlight the selected network', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      // The selected tab should have the active background color class
      expect(testnetButton).toHaveClass('bg-amber-100');
    });

    it('should call onNetworkChange when a different network is clicked', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      fireEvent.click(testnetButton!);

      expect(mockOnNetworkChange).toHaveBeenCalledWith('testnet');
      expect(mockOnNetworkChange).toHaveBeenCalledTimes(1);
    });

    it('should still call onNetworkChange when clicking already selected network', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const mainnetButton = screen.getByText('Mainnet').closest('button');
      fireEvent.click(mainnetButton!);

      expect(mockOnNetworkChange).toHaveBeenCalledWith('mainnet');
    });

    it('should handle clicking signet tab', () => {
      render(<NetworkTabs {...defaultProps} />);

      const signetButton = screen.getByText('Signet').closest('button');
      fireEvent.click(signetButton!);

      expect(mockOnNetworkChange).toHaveBeenCalledWith('signet');
    });
  });

  describe('Empty states', () => {
    it('should show all networks even when wallet count is zero', () => {
      render(
        <NetworkTabs
          {...defaultProps}
          walletCounts={{ mainnet: 0, testnet: 0, signet: 0 }}
        />
      );

      expect(screen.getByText('Mainnet')).toBeInTheDocument();
      expect(screen.getByText('Testnet')).toBeInTheDocument();
      expect(screen.getByText('Signet')).toBeInTheDocument();
    });

    it('should apply muted styling to empty networks', () => {
      render(
        <NetworkTabs
          {...defaultProps}
          walletCounts={{ mainnet: 1, testnet: 0, signet: 0 }}
          selectedNetwork="mainnet"
        />
      );

      const testnetButton = screen.getByText('Testnet').closest('button');
      // Empty, non-selected networks should have muted text color
      expect(testnetButton).toHaveClass('text-sanctuary-400');
    });
  });

  describe('Color coding', () => {
    it('should use emerald colors for mainnet when selected', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const mainnetButton = screen.getByText('Mainnet').closest('button');
      expect(mainnetButton).toHaveClass('border-emerald-200');
    });

    it('should use amber colors for testnet when selected', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveClass('border-amber-200');
    });

    it('should use purple colors for signet when selected', () => {
      render(
        <NetworkTabs
          {...defaultProps}
          walletCounts={{ mainnet: 1, testnet: 1, signet: 1 }}
          selectedNetwork="signet"
        />
      );

      const signetButton = screen.getByText('Signet').closest('button');
      expect(signetButton).toHaveClass('border-purple-200');
    });
  });
});
