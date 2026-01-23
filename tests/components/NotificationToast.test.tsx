import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NotificationToast,
  NotificationContainer,
  generateNotificationId,
  type Notification,
} from '../../components/NotificationToast';

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon" />,
  ArrowDownLeft: () => <span data-testid="down-icon" />,
  ArrowUpRight: () => <span data-testid="up-icon" />,
  CheckCircle: () => <span data-testid="check-icon" />,
  TrendingUp: () => <span data-testid="trend-icon" />,
  Activity: () => <span data-testid="activity-icon" />,
}));

const baseNotification: Notification = {
  id: 'notif-1',
  type: 'transaction',
  title: 'Transaction received',
  message: '0.01 BTC received',
  duration: undefined,
  data: { type: 'received' },
};

describe('NotificationToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders notification content and icon', () => {
    render(<NotificationToast notification={baseNotification} onDismiss={vi.fn()} />);
    expect(screen.getByText('Transaction received')).toBeInTheDocument();
    expect(screen.getByText('0.01 BTC received')).toBeInTheDocument();
    expect(screen.getByTestId('down-icon')).toBeInTheDocument();
  });

  it('dismisses when close button clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onDismiss = vi.fn();

    render(<NotificationToast notification={baseNotification} onDismiss={onDismiss} />);

    await user.click(screen.getByLabelText('Dismiss notification'));
    vi.advanceTimersByTime(300);
    expect(onDismiss).toHaveBeenCalledWith('notif-1');
  });

  it('auto-dismisses after duration', () => {
    const onDismiss = vi.fn();

    render(
      <NotificationToast
        notification={{ ...baseNotification, duration: 500 }}
        onDismiss={onDismiss}
      />
    );

    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(300);
    expect(onDismiss).toHaveBeenCalledWith('notif-1');
  });

  it('applies error styles', () => {
    const { container } = render(
      <NotificationToast
        notification={{ ...baseNotification, type: 'error' }}
        onDismiss={vi.fn()}
      />
    );

    expect(container.firstChild).toHaveClass('bg-rose-50');
  });
});

describe('NotificationContainer', () => {
  it('renders nothing when empty', () => {
    const { container } = render(
      <NotificationContainer notifications={[]} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders multiple toasts', () => {
    render(
      <NotificationContainer
        notifications={[baseNotification, { ...baseNotification, id: '2', title: 'Second' }]}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText('Transaction received')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});

describe('generateNotificationId', () => {
  it('returns a unique-ish string', () => {
    const id = generateNotificationId();
    expect(id).toMatch(/^notification-\d+-[a-z0-9]+$/);
  });
});
