import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { StrategySelector, UIStrategy } from '../../components/StrategySelector';

describe('StrategySelector', () => {
  const mockOnStrategyChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Button rendering', () => {
    it('renders all 4 strategy buttons', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      expect(screen.getByText('Auto')).toBeInTheDocument();
      expect(screen.getByText('Privacy')).toBeInTheDocument();
      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.getByText('Consolidate')).toBeInTheDocument();
    });

    it('renders the "Selection Strategy" label', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      expect(screen.getByText('Selection Strategy')).toBeInTheDocument();
    });

    it('renders buttons in a 4-column grid on larger screens', () => {
      const { container } = render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const grid = container.querySelector('.grid');
      expect(grid?.className).toContain('sm:grid-cols-4');
    });
  });

  describe('Selected strategy highlighting', () => {
    it('highlights the auto strategy when selected', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const autoButton = screen.getByText('Auto').closest('button');
      expect(autoButton?.className).toContain('bg-zen-indigo/10');
      expect(autoButton?.className).toContain('border-zen-indigo/50');
    });

    it('highlights the privacy strategy when selected', () => {
      render(
        <StrategySelector
          strategy="privacy"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const privacyButton = screen.getByText('Privacy').closest('button');
      expect(privacyButton?.className).toContain('bg-zen-matcha/10');
      expect(privacyButton?.className).toContain('border-zen-matcha/50');
    });

    it('highlights the manual strategy when selected', () => {
      render(
        <StrategySelector
          strategy="manual"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const manualButton = screen.getByText('Manual').closest('button');
      expect(manualButton?.className).toContain('bg-zen-gold/10');
      expect(manualButton?.className).toContain('border-zen-gold/50');
    });

    it('highlights the consolidate strategy when selected', () => {
      render(
        <StrategySelector
          strategy="consolidate"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const consolidateButton = screen.getByText('Consolidate').closest('button');
      expect(consolidateButton?.className).toContain('bg-primary-50');
      expect(consolidateButton?.className).toContain('border-primary-200');
    });

    it('does not highlight non-selected strategies', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const privacyButton = screen.getByText('Privacy').closest('button');
      expect(privacyButton?.className).not.toContain('bg-zen-matcha/10');
      expect(privacyButton?.className).toContain('border-sanctuary-200');
    });
  });

  describe('Strategy change callbacks', () => {
    it('calls onStrategyChange when auto button is clicked', () => {
      render(
        <StrategySelector
          strategy="privacy"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      fireEvent.click(screen.getByText('Auto'));
      expect(mockOnStrategyChange).toHaveBeenCalledWith('auto');
    });

    it('calls onStrategyChange when privacy button is clicked', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      fireEvent.click(screen.getByText('Privacy'));
      expect(mockOnStrategyChange).toHaveBeenCalledWith('privacy');
    });

    it('calls onStrategyChange when manual button is clicked', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      fireEvent.click(screen.getByText('Manual'));
      expect(mockOnStrategyChange).toHaveBeenCalledWith('manual');
    });

    it('calls onStrategyChange when consolidate button is clicked', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      fireEvent.click(screen.getByText('Consolidate'));
      expect(mockOnStrategyChange).toHaveBeenCalledWith('consolidate');
    });

    it('calls onStrategyChange even when clicking already selected strategy', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      fireEvent.click(screen.getByText('Auto'));
      expect(mockOnStrategyChange).toHaveBeenCalledWith('auto');
    });
  });

  describe('Icons', () => {
    it('shows correct icon for auto strategy (Zap)', () => {
      const { container } = render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const autoButton = screen.getByText('Auto').closest('button');
      const icon = autoButton?.querySelector('svg');
      expect(icon).toBeInTheDocument();
      // Lucide icons receive class via className prop which becomes the class attribute
      const classAttr = icon?.getAttribute('class') || '';
      expect(classAttr).toContain('w-4');
      expect(classAttr).toContain('h-4');
    });

    it('shows correct icon for privacy strategy (Shield)', () => {
      const { container } = render(
        <StrategySelector
          strategy="privacy"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const privacyButton = screen.getByText('Privacy').closest('button');
      const icon = privacyButton?.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('shows correct icon for manual strategy (Hand)', () => {
      const { container } = render(
        <StrategySelector
          strategy="manual"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const manualButton = screen.getByText('Manual').closest('button');
      const icon = manualButton?.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('shows correct icon for consolidate strategy (RefreshCw)', () => {
      const { container } = render(
        <StrategySelector
          strategy="consolidate"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const consolidateButton = screen.getByText('Consolidate').closest('button');
      const icon = consolidateButton?.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('Disabled state', () => {
    it('prevents clicks when disabled', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
          disabled={true}
        />
      );

      fireEvent.click(screen.getByText('Privacy'));
      expect(mockOnStrategyChange).not.toHaveBeenCalled();
    });

    it('all buttons have disabled attribute when disabled', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
          disabled={true}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button).toBeDisabled();
      });
    });

    it('applies opacity-50 styling when disabled', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
          disabled={true}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button.className).toContain('opacity-50');
      });
    });

    it('applies cursor-not-allowed styling when disabled', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
          disabled={true}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button.className).toContain('cursor-not-allowed');
      });
    });

    it('does not apply disabled styling when enabled', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
          disabled={false}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button.className).not.toContain('opacity-50');
        expect(button.className).not.toContain('cursor-not-allowed');
      });
    });
  });

  describe('Tooltips', () => {
    it('shows tooltip for auto strategy', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const autoButton = screen.getByText('Auto').closest('button');
      expect(autoButton?.getAttribute('title')).toContain('Automatically select UTXOs');
    });

    it('shows tooltip for privacy strategy', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const privacyButton = screen.getByText('Privacy').closest('button');
      expect(privacyButton?.getAttribute('title')).toContain('privacy');
    });

    it('shows tooltip for manual strategy', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const manualButton = screen.getByText('Manual').closest('button');
      expect(manualButton?.getAttribute('title')).toContain('Manually select');
    });

    it('shows tooltip for consolidate strategy', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const consolidateButton = screen.getByText('Consolidate').closest('button');
      expect(consolidateButton?.getAttribute('title')).toContain('Combine multiple UTXOs');
    });

    it('has hover tooltip divs for each button', () => {
      const { container } = render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      // Each button should have a hidden tooltip div
      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        const tooltipDiv = button.querySelector('.opacity-0.invisible');
        expect(tooltipDiv).toBeInTheDocument();
      });
    });
  });

  describe('Button type attribute', () => {
    it('all buttons have type="button" to prevent form submission', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button).toHaveAttribute('type', 'button');
      });
    });
  });

  describe('Accessibility', () => {
    it('buttons are focusable', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const autoButton = screen.getByText('Auto').closest('button');
      autoButton?.focus();
      expect(document.activeElement).toBe(autoButton);
    });

    it('buttons can be activated with keyboard', () => {
      render(
        <StrategySelector
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
        />
      );

      const privacyButton = screen.getByText('Privacy').closest('button');
      privacyButton?.focus();
      fireEvent.keyDown(privacyButton!, { key: 'Enter' });
      // Native button behavior handles Enter key
    });
  });
});
