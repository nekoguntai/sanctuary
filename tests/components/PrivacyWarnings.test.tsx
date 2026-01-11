/**
 * Tests for components/PrivacyWarnings.tsx
 *
 * Tests the privacy warnings display component including the parseWarnings
 * utility function, warning rendering, severity styling, and dismissal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PrivacyWarnings, parseWarnings, PrivacyWarning } from '../../components/PrivacyWarnings';

describe('parseWarnings', () => {
  it('parses address linking warnings as high severity', () => {
    const warnings = parseWarnings(['This transaction may link addresses together']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('address_linking');
    expect(warnings[0].severity).toBe('high');
    expect(warnings[0].message).toBe('This transaction may link addresses together');
  });

  it('parses round amount warnings as medium severity', () => {
    const warnings = parseWarnings(['Sending a round amount may reduce privacy']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('round_amount');
    expect(warnings[0].severity).toBe('medium');
  });

  it('parses address reuse warnings as high severity', () => {
    const warnings = parseWarnings(['Address reuse detected']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('address_reuse');
    expect(warnings[0].severity).toBe('high');
  });

  it('parses "reused" keyword as address_reuse', () => {
    const warnings = parseWarnings(['This address has been reused']);

    expect(warnings[0].type).toBe('address_reuse');
    expect(warnings[0].severity).toBe('high');
  });

  it('parses privacy score warnings as low severity', () => {
    const warnings = parseWarnings(['Low privacy score detected']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('privacy_score_disparity');
    expect(warnings[0].severity).toBe('low');
  });

  it('parses dust warnings as low severity', () => {
    const warnings = parseWarnings(['This consolidates dust outputs']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('dust_consolidation');
    expect(warnings[0].severity).toBe('low');
  });

  it('defaults to general type for unrecognized warnings', () => {
    const warnings = parseWarnings(['Some unknown warning message']);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('general');
    expect(warnings[0].severity).toBe('medium');
  });

  it('parses multiple warnings', () => {
    const warnings = parseWarnings([
      'Address linking detected',
      'Sending a round amount',
      'Some general message',
    ]);

    expect(warnings).toHaveLength(3);
    expect(warnings[0].type).toBe('address_linking');
    expect(warnings[1].type).toBe('round_amount');
    expect(warnings[2].type).toBe('general');
  });

  it('returns empty array for empty input', () => {
    const warnings = parseWarnings([]);
    expect(warnings).toHaveLength(0);
  });
});

describe('PrivacyWarnings', () => {
  const defaultWarnings: PrivacyWarning[] = [
    { type: 'address_linking', severity: 'high', message: 'This transaction links addresses' },
    { type: 'round_amount', severity: 'medium', message: 'Round amount detected' },
    { type: 'dust_consolidation', severity: 'low', message: 'Consolidating dust' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders warning messages', () => {
      render(<PrivacyWarnings warnings={defaultWarnings} />);

      expect(screen.getByText('This transaction links addresses')).toBeInTheDocument();
      expect(screen.getByText('Round amount detected')).toBeInTheDocument();
      expect(screen.getByText('Consolidating dust')).toBeInTheDocument();
    });

    it('renders Privacy Considerations header', () => {
      render(<PrivacyWarnings warnings={defaultWarnings} />);

      expect(screen.getByText('Privacy Considerations')).toBeInTheDocument();
    });

    it('renders nothing when warnings array is empty', () => {
      const { container } = render(<PrivacyWarnings warnings={[]} />);

      expect(container.firstChild).toBeNull();
    });

    it('applies custom className', () => {
      const { container } = render(
        <PrivacyWarnings warnings={defaultWarnings} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('severity styling', () => {
    it('applies high severity styling', () => {
      render(
        <PrivacyWarnings
          warnings={[{ type: 'address_linking', severity: 'high', message: 'High severity' }]}
        />
      );

      const warningElement = screen.getByText('High severity').closest('div');
      expect(warningElement).toHaveClass('bg-amber-50');
    });

    it('applies medium severity styling', () => {
      render(
        <PrivacyWarnings
          warnings={[{ type: 'round_amount', severity: 'medium', message: 'Medium severity' }]}
        />
      );

      const warningElement = screen.getByText('Medium severity').closest('div');
      expect(warningElement).toHaveClass('bg-yellow-50');
    });

    it('applies low severity styling', () => {
      render(
        <PrivacyWarnings
          warnings={[{ type: 'dust_consolidation', severity: 'low', message: 'Low severity' }]}
        />
      );

      const warningElement = screen.getByText('Low severity').closest('div');
      expect(warningElement).toHaveClass('bg-blue-50');
    });
  });

  describe('dismissal', () => {
    it('renders dismiss buttons when onDismiss is provided', () => {
      const onDismiss = vi.fn();
      render(<PrivacyWarnings warnings={defaultWarnings} onDismiss={onDismiss} />);

      const dismissButtons = screen.getAllByTitle('Dismiss warning');
      expect(dismissButtons).toHaveLength(3);
    });

    it('does not render dismiss buttons when onDismiss is not provided', () => {
      render(<PrivacyWarnings warnings={defaultWarnings} />);

      expect(screen.queryByTitle('Dismiss warning')).not.toBeInTheDocument();
    });

    it('calls onDismiss with warning type when dismiss button is clicked', () => {
      const onDismiss = vi.fn();
      render(<PrivacyWarnings warnings={defaultWarnings} onDismiss={onDismiss} />);

      const dismissButtons = screen.getAllByTitle('Dismiss warning');
      fireEvent.click(dismissButtons[0]);

      expect(onDismiss).toHaveBeenCalledWith('address_linking');
    });
  });

  describe('dismissed warnings', () => {
    it('filters out dismissed warnings', () => {
      const dismissedWarnings = new Set(['address_linking']);
      render(
        <PrivacyWarnings
          warnings={defaultWarnings}
          dismissedWarnings={dismissedWarnings}
        />
      );

      expect(screen.queryByText('This transaction links addresses')).not.toBeInTheDocument();
      expect(screen.getByText('Round amount detected')).toBeInTheDocument();
      expect(screen.getByText('Consolidating dust')).toBeInTheDocument();
    });

    it('renders nothing when all warnings are dismissed', () => {
      const dismissedWarnings = new Set(['address_linking', 'round_amount', 'dust_consolidation']);
      const { container } = render(
        <PrivacyWarnings
          warnings={defaultWarnings}
          dismissedWarnings={dismissedWarnings}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('icons', () => {
    it('renders AlertTriangle icons for each warning', () => {
      render(<PrivacyWarnings warnings={defaultWarnings} />);

      // Check for lucide icon class
      const icons = document.querySelectorAll('.lucide-triangle-alert');
      expect(icons.length).toBe(3);
    });

    it('renders Shield icon in header', () => {
      render(<PrivacyWarnings warnings={defaultWarnings} />);

      const shieldIcon = document.querySelector('.lucide-shield');
      expect(shieldIcon).toBeInTheDocument();
    });
  });
});
