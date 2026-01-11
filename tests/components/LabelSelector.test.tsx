/**
 * Tests for components/LabelSelector.tsx
 *
 * Tests the label selector component including dropdown mode, inline mode,
 * label CRUD operations, and the LabelBadges component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { LabelSelector, LabelBadges } from '../../components/LabelSelector';
import * as labelsApi from '../../src/api/labels';
import type { Label } from '../../src/api/labels';

// Mock the labels API
vi.mock('../../src/api/labels', () => ({
  getLabels: vi.fn(),
  createLabel: vi.fn(),
}));

describe('LabelSelector', () => {
  const mockLabels: Label[] = [
    { id: 'label-1', name: 'Personal', color: '#3B82F6', walletId: 'wallet-1' },
    { id: 'label-2', name: 'Business', color: '#10B981', walletId: 'wallet-1' },
    { id: 'label-3', name: 'Savings', color: '#F59E0B', walletId: 'wallet-1' },
  ];

  const defaultProps = {
    walletId: 'wallet-1',
    selectedLabels: [] as Label[],
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labelsApi.getLabels).mockResolvedValue(mockLabels);
    vi.mocked(labelsApi.createLabel).mockResolvedValue({
      id: 'new-label',
      name: 'New Label',
      color: '#6366F1',
      walletId: 'wallet-1',
    });
  });

  describe('dropdown mode (default)', () => {
    describe('rendering', () => {
      it('renders trigger button with placeholder', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(screen.getByText('Select labels...')).toBeInTheDocument();
        });
      });

      it('renders selected labels in trigger button', async () => {
        render(
          <LabelSelector
            {...defaultProps}
            selectedLabels={[mockLabels[0], mockLabels[1]]}
          />
        );

        await waitFor(() => {
          expect(screen.getByText('Personal')).toBeInTheDocument();
          expect(screen.getByText('Business')).toBeInTheDocument();
        });
      });

      it('renders chevron icon', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          const chevron = document.querySelector('.lucide-chevron-down');
          expect(chevron).toBeInTheDocument();
        });
      });
    });

    describe('dropdown interaction', () => {
      it('opens dropdown when clicked', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(screen.getByText('Select labels...')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Select labels...'));

        expect(screen.getByPlaceholderText('Search labels...')).toBeInTheDocument();
      });

      it('shows available labels in dropdown', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));

        await waitFor(() => {
          expect(screen.getByText('Personal')).toBeInTheDocument();
          expect(screen.getByText('Business')).toBeInTheDocument();
          expect(screen.getByText('Savings')).toBeInTheDocument();
        });
      });

      it('shows checkmark for selected labels', async () => {
        render(
          <LabelSelector
            {...defaultProps}
            selectedLabels={[mockLabels[0]]}
          />
        );

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Personal'));

        await waitFor(() => {
          const checkIcons = document.querySelectorAll('.lucide-check');
          expect(checkIcons.length).toBeGreaterThan(0);
        });
      });

      it('closes dropdown when clicking outside', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(screen.getByText('Select labels...')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText('Select labels...'));
        expect(screen.getByPlaceholderText('Search labels...')).toBeInTheDocument();

        // Click outside
        fireEvent.mouseDown(document.body);

        expect(screen.queryByPlaceholderText('Search labels...')).not.toBeInTheDocument();
      });
    });

    describe('selecting labels', () => {
      it('calls onChange when label is selected', async () => {
        const onChange = vi.fn();
        render(<LabelSelector {...defaultProps} onChange={onChange} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));

        await waitFor(() => {
          expect(screen.getByText('Personal')).toBeInTheDocument();
        });

        // Click on a label in the dropdown
        const labelButtons = screen.getAllByRole('button');
        const personalButton = labelButtons.find(btn => btn.textContent?.includes('Personal') && btn.closest('.py-1'));
        if (personalButton) {
          fireEvent.click(personalButton);
        }

        expect(onChange).toHaveBeenCalled();
      });

      it('removes label when selected label is clicked again', async () => {
        const onChange = vi.fn();
        render(
          <LabelSelector
            {...defaultProps}
            selectedLabels={[mockLabels[0]]}
            onChange={onChange}
          />
        );

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Personal'));

        await waitFor(() => {
          const dropdownLabels = document.querySelectorAll('.py-1 button');
          if (dropdownLabels[0]) {
            fireEvent.click(dropdownLabels[0]);
          }
        });

        expect(onChange).toHaveBeenCalled();
      });
    });

    describe('search', () => {
      it('filters labels based on search query', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));
        fireEvent.change(screen.getByPlaceholderText('Search labels...'), {
          target: { value: 'pers' },
        });

        await waitFor(() => {
          expect(screen.getByText('Personal')).toBeInTheDocument();
          expect(screen.queryByText('Business')).not.toBeInTheDocument();
          expect(screen.queryByText('Savings')).not.toBeInTheDocument();
        });
      });

      it('shows "No labels found" when search has no results', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));
        fireEvent.change(screen.getByPlaceholderText('Search labels...'), {
          target: { value: 'nonexistent' },
        });

        await waitFor(() => {
          expect(screen.getByText('No labels found')).toBeInTheDocument();
        });
      });
    });

    describe('creating labels', () => {
      it('shows create option by default', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));

        expect(screen.getByText('Create new label')).toBeInTheDocument();
      });

      it('hides create option when showCreateOption is false', async () => {
        render(<LabelSelector {...defaultProps} showCreateOption={false} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));

        expect(screen.queryByText('Create new label')).not.toBeInTheDocument();
      });

      it('shows create input when Create new label is clicked', async () => {
        render(<LabelSelector {...defaultProps} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));
        fireEvent.click(screen.getByText('Create new label'));

        expect(screen.getByPlaceholderText('New label name...')).toBeInTheDocument();
      });

      it('calls createLabel API when new label is submitted', async () => {
        const onChange = vi.fn();
        render(<LabelSelector {...defaultProps} onChange={onChange} />);

        await waitFor(() => {
          expect(labelsApi.getLabels).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByText('Select labels...'));
        fireEvent.click(screen.getByText('Create new label'));

        const input = screen.getByPlaceholderText('New label name...');
        fireEvent.change(input, { target: { value: 'New Label' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
          expect(labelsApi.createLabel).toHaveBeenCalledWith('wallet-1', {
            name: 'New Label',
          });
        });
      });
    });

    describe('disabled state', () => {
      it('disables trigger button when disabled', async () => {
        render(<LabelSelector {...defaultProps} disabled={true} />);

        const button = screen.getByRole('button');
        expect(button).toBeDisabled();
      });

      it('does not open dropdown when disabled', async () => {
        render(<LabelSelector {...defaultProps} disabled={true} />);

        fireEvent.click(screen.getByRole('button'));

        expect(screen.queryByPlaceholderText('Search labels...')).not.toBeInTheDocument();
      });
    });
  });

  describe('inline mode', () => {
    it('renders selected labels as chips', async () => {
      render(
        <LabelSelector
          {...defaultProps}
          mode="inline"
          selectedLabels={[mockLabels[0], mockLabels[1]]}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Personal')).toBeInTheDocument();
        expect(screen.getByText('Business')).toBeInTheDocument();
      });
    });

    it('shows Add Label button when there are available labels', async () => {
      render(
        <LabelSelector
          {...defaultProps}
          mode="inline"
          selectedLabels={[mockLabels[0]]}
        />
      );

      await waitFor(() => {
        expect(labelsApi.getLabels).toHaveBeenCalled();
      });

      expect(screen.getByText('Add Label')).toBeInTheDocument();
    });

    it('removes label when X is clicked', async () => {
      const onChange = vi.fn();
      render(
        <LabelSelector
          {...defaultProps}
          mode="inline"
          selectedLabels={[mockLabels[0]]}
          onChange={onChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Personal')).toBeInTheDocument();
      });

      const xIcon = document.querySelector('.lucide-x');
      if (xIcon) {
        fireEvent.click(xIcon);
      }

      expect(onChange).toHaveBeenCalledWith([]);
    });
  });

  describe('loading state', () => {
    it('shows loading spinner while fetching labels', async () => {
      vi.mocked(labelsApi.getLabels).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<LabelSelector {...defaultProps} />);

      fireEvent.click(screen.getByText('Select labels...'));

      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe('className prop', () => {
    it('applies custom className', async () => {
      const { container } = render(
        <LabelSelector {...defaultProps} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });
});

describe('LabelBadges', () => {
  const mockLabels: Label[] = [
    { id: 'label-1', name: 'Personal', color: '#3B82F6', walletId: 'wallet-1' },
    { id: 'label-2', name: 'Business', color: '#10B981', walletId: 'wallet-1' },
    { id: 'label-3', name: 'Savings', color: '#F59E0B', walletId: 'wallet-1' },
    { id: 'label-4', name: 'Trading', color: '#EF4444', walletId: 'wallet-1' },
  ];

  it('renders nothing when labels array is empty', () => {
    const { container } = render(<LabelBadges labels={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when labels is undefined', () => {
    const { container } = render(<LabelBadges labels={undefined as any} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all labels when under maxDisplay', () => {
    render(<LabelBadges labels={mockLabels.slice(0, 2)} />);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
  });

  it('respects maxDisplay limit', () => {
    render(<LabelBadges labels={mockLabels} maxDisplay={2} />);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.queryByText('Savings')).not.toBeInTheDocument();
    expect(screen.queryByText('Trading')).not.toBeInTheDocument();
  });

  it('shows remaining count when exceeding maxDisplay', () => {
    render(<LabelBadges labels={mockLabels} maxDisplay={2} />);

    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('uses default maxDisplay of 3', () => {
    render(<LabelBadges labels={mockLabels} />);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('applies onClick handler', () => {
    const onClick = vi.fn();
    render(<LabelBadges labels={mockLabels.slice(0, 1)} onClick={onClick} />);

    fireEvent.click(screen.getByText('Personal'));

    expect(onClick).toHaveBeenCalled();
  });

  it('renders with sm size by default', () => {
    render(<LabelBadges labels={mockLabels.slice(0, 1)} />);

    const badge = screen.getByText('Personal').closest('span');
    expect(badge).toHaveClass('px-1.5', 'py-0.5', 'text-xs');
  });

  it('renders with md size when specified', () => {
    render(<LabelBadges labels={mockLabels.slice(0, 1)} size="md" />);

    const badge = screen.getByText('Personal').closest('span');
    expect(badge).toHaveClass('px-2', 'py-0.5', 'text-sm');
  });

  it('applies label color as background', () => {
    render(<LabelBadges labels={[mockLabels[0]]} />);

    const badge = screen.getByText('Personal').closest('span');
    expect(badge).toHaveStyle({ backgroundColor: '#3B82F6' });
  });
});
