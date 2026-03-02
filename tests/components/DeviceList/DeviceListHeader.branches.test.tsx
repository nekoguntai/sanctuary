import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeviceListHeader } from '../../../components/DeviceList/DeviceListHeader';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../components/ui/ColumnConfigButton', () => ({
  ColumnConfigButton: () => <div data-testid="column-config">Column Config</div>,
}));

const buildProps = (overrides: Partial<React.ComponentProps<typeof DeviceListHeader>> = {}) => ({
  deviceCount: 6,
  ownedCount: 4,
  sharedCount: 2,
  viewMode: 'grouped' as const,
  setViewMode: vi.fn(),
  ownershipFilter: 'all' as const,
  setOwnershipFilter: vi.fn(),
  columnOrder: [],
  visibleColumns: [],
  onColumnOrderChange: vi.fn(),
  onColumnVisibilityChange: vi.fn(),
  onColumnReset: vi.fn(),
  ...overrides,
});

describe('DeviceListHeader branch coverage', () => {
  it('covers ownership filter active branches and list-view callback', () => {
    const setOwnershipFilter = vi.fn();
    const setViewMode = vi.fn();
    const props = buildProps({ setOwnershipFilter, setViewMode });
    const { rerender } = render(<DeviceListHeader {...props} />);

    const allButton = screen.getByRole('button', { name: 'All (6)' });
    expect(allButton.className).toContain('surface-secondary');
    fireEvent.click(allButton);
    expect(setOwnershipFilter).toHaveBeenCalledWith('all');

    rerender(<DeviceListHeader {...buildProps({ ownershipFilter: 'owned', setOwnershipFilter, setViewMode })} />);
    expect(screen.getByRole('button', { name: 'Owned (4)' }).className).toContain('surface-secondary');

    rerender(<DeviceListHeader {...buildProps({ ownershipFilter: 'shared', setOwnershipFilter, setViewMode })} />);
    expect(screen.getByRole('button', { name: 'Shared (2)' }).className).toContain('surface-secondary');

    fireEvent.click(screen.getByRole('button', { name: 'List View' }));
    expect(setViewMode).toHaveBeenCalledWith('list');
  });

  it('covers list-mode column config visibility and connect navigation', () => {
    render(<DeviceListHeader {...buildProps({ viewMode: 'list' })} />);

    expect(screen.getByTestId('column-config')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Connect New Device/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/devices/connect');
  });
});
