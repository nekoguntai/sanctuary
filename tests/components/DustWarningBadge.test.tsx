import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { DustWarningBadge } from '../../components/DustWarningBadge';

describe('DustWarningBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Label visibility', () => {
    it('renders with "DUST" label when showLabel=true (default)', () => {
      render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      expect(screen.getByText('DUST')).toBeInTheDocument();
    });

    it('renders with "DUST" label when showLabel is explicitly true', () => {
      render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
          showLabel={true}
        />
      );

      expect(screen.getByText('DUST')).toBeInTheDocument();
    });

    it('hides label when showLabel=false', () => {
      render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
          showLabel={false}
        />
      );

      expect(screen.queryByText('DUST')).not.toBeInTheDocument();
    });
  });

  describe('Tooltip content', () => {
    it('shows correct spend cost in tooltip', () => {
      render(
        <DustWarningBadge
          spendCost={680}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      expect(badge).toHaveAttribute('title');
      expect(badge?.getAttribute('title')).toContain('680');
    });

    it('shows fee rate in tooltip', () => {
      render(
        <DustWarningBadge
          spendCost={680}
          utxoAmount={1000}
          feeRate={10.5}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      expect(badge?.getAttribute('title')).toContain('10.5 sat/vB');
    });

    it('includes consolidation suggestion in tooltip', () => {
      render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      expect(badge?.getAttribute('title')).toContain('consolidating');
    });
  });

  describe('Percentage calculation', () => {
    it('calculates percentage correctly for 50% cost', () => {
      render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      expect(badge?.getAttribute('title')).toContain('50%');
    });

    it('calculates percentage correctly for 100% cost', () => {
      render(
        <DustWarningBadge
          spendCost={1000}
          utxoAmount={1000}
          feeRate={15}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      expect(badge?.getAttribute('title')).toContain('100%');
    });

    it('calculates percentage correctly when cost exceeds value', () => {
      render(
        <DustWarningBadge
          spendCost={1500}
          utxoAmount={1000}
          feeRate={22}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      expect(badge?.getAttribute('title')).toContain('150%');
    });

    it('rounds percentage to whole numbers', () => {
      render(
        <DustWarningBadge
          spendCost={333}
          utxoAmount={1000}
          feeRate={5}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      // 333/1000 = 33.3%, should round to 33%
      expect(badge?.getAttribute('title')).toContain('33%');
    });
  });

  describe('Size variants', () => {
    it('renders small size variant correctly (default)', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = container.querySelector('span');
      expect(badge?.className).toContain('px-1.5');
      expect(badge?.className).toContain('py-0.5');
      expect(badge?.className).toContain('text-[9px]');
    });

    it('renders small size variant correctly when explicitly set', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
          size="sm"
        />
      );

      const badge = container.querySelector('span');
      expect(badge?.className).toContain('px-1.5');
      expect(badge?.className).toContain('py-0.5');
      expect(badge?.className).toContain('text-[9px]');
    });

    it('renders medium size variant correctly', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
          size="md"
        />
      );

      const badge = container.querySelector('span');
      expect(badge?.className).toContain('px-2');
      expect(badge?.className).toContain('py-1');
      expect(badge?.className).toContain('text-[10px]');
    });

    it('renders icon with correct size for small variant', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
          size="sm"
        />
      );

      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
      // Lucide icons receive class via className prop which becomes the class attribute
      const classAttr = icon?.getAttribute('class') || '';
      expect(classAttr).toContain('w-2.5');
      expect(classAttr).toContain('h-2.5');
    });

    it('renders icon with correct size for medium variant', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
          size="md"
        />
      );

      const icon = container.querySelector('svg');
      expect(icon).toBeInTheDocument();
      const classAttr = icon?.getAttribute('class') || '';
      expect(classAttr).toContain('w-3');
      expect(classAttr).toContain('h-3');
    });
  });

  describe('Styling', () => {
    it('has amber warning colors for light mode', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = container.querySelector('span');
      expect(badge?.className).toContain('bg-amber-100');
      expect(badge?.className).toContain('text-amber-700');
    });

    it('has dark mode amber colors', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = container.querySelector('span');
      expect(badge?.className).toContain('dark:bg-amber-900/30');
      expect(badge?.className).toContain('dark:text-amber-300');
    });

    it('has inline-flex display for proper alignment', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = container.querySelector('span');
      expect(badge?.className).toContain('inline-flex');
      expect(badge?.className).toContain('items-center');
    });

    it('has rounded corners', () => {
      const { container } = render(
        <DustWarningBadge
          spendCost={500}
          utxoAmount={1000}
          feeRate={10}
        />
      );

      const badge = container.querySelector('span');
      expect(badge?.className).toContain('rounded');
    });
  });

  describe('Localization of spend cost', () => {
    it('formats large spend cost with locale-specific separators', () => {
      render(
        <DustWarningBadge
          spendCost={1500}
          utxoAmount={2000}
          feeRate={22}
        />
      );

      const badge = screen.getByText('DUST').closest('span');
      // 1500 should be formatted with locale (e.g., "1,500" in en-US)
      expect(badge?.getAttribute('title')).toContain('1,500');
    });
  });
});
