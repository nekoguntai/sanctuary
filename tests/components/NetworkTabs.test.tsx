import { fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NetworkTabs,TabNetwork } from '../../components/NetworkTabs';

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

    it('should render network color dots for each tab', () => {
      const { container } = render(<NetworkTabs {...defaultProps} />);

      const dots = container.querySelectorAll('[aria-hidden="true"]');
      expect(dots).toHaveLength(3);
      expect(dots[0]).toHaveClass('bg-mainnet-500');
      expect(dots[1]).toHaveClass('bg-testnet-500');
      expect(dots[2]).toHaveClass('bg-signet-500');
    });

    it('should render a sliding indicator element', () => {
      const { container } = render(<NetworkTabs {...defaultProps} />);

      const indicator = container.querySelector('.shadow-sm');
      expect(indicator).toBeInTheDocument();
    });
  });

  describe('Selection', () => {
    it('should mark the selected network tab as active', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveAttribute('data-active', 'true');
    });

    it('should mark non-selected tabs as inactive', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveAttribute('data-active', 'false');
    });

    it('should visually highlight the selected network with active text color', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="testnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-900');
    });

    it('should apply muted text to non-selected tabs', () => {
      render(<NetworkTabs {...defaultProps} selectedNetwork="mainnet" />);

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-500');
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

    it('should apply muted styling to non-selected networks regardless of count', () => {
      render(
        <NetworkTabs
          {...defaultProps}
          walletCounts={{ mainnet: 1, testnet: 0, signet: 0 }}
          selectedNetwork="mainnet"
        />
      );

      const testnetButton = screen.getByText('Testnet').closest('button');
      expect(testnetButton).toHaveClass('text-sanctuary-500');
    });
  });
});
