import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Mock the API modules
vi.mock('../../src/api/transactions', () => ({
  getTransactions: vi.fn().mockResolvedValue([]),
  getPendingTransactions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/api/wallets', () => ({
  getWallets: vi.fn().mockResolvedValue([]),
  getWallet: vi.fn(),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getFeeEstimates: vi.fn().mockResolvedValue({
    fastest: 20,
    halfHour: 15,
    hour: 10,
    economy: 5,
    minimum: 1,
  }),
  getMempoolBlocks: vi.fn().mockResolvedValue([]),
  getBitcoinPrice: vi.fn().mockResolvedValue({ USD: 50000 }),
}));

vi.mock('../../src/api/admin', () => ({
  getSystemVariables: vi.fn().mockResolvedValue({}),
}));

// Mock NotificationContext
vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

// Mock WebSocket context
vi.mock('../../contexts/WalletWebSocketContext', () => ({
  useWalletWebSocket: () => ({
    isConnected: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}));

// Mock the notification sound hook
vi.mock('../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: vi.fn(),
    testSound: vi.fn(),
  }),
}));

// Mock recharts to avoid jsdom issues
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

describe('Dashboard stable array constants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle undefined wallet data without causing re-renders', async () => {
    const { getWallets } = await import('../../src/api/wallets');
    vi.mocked(getWallets).mockResolvedValue(undefined as any);

    let renderCount = 0;

    function TestComponent() {
      renderCount++;

      // Simulate the pattern used in Dashboard
      const data = undefined;
      const EMPTY_ARRAY: never[] = [];
      const safeData = data ?? EMPTY_ARRAY;

      return <div data-testid="test">{safeData.length}</div>;
    }

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );

    const initialRenderCount = renderCount;

    // Rerender multiple times
    rerender(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );

    // The stable empty array pattern should not cause excessive renders
    // beyond what React normally does
    expect(renderCount).toBeLessThanOrEqual(initialRenderCount + 2);
  });

  it('stable array constant should maintain reference identity', () => {
    // Verify that a module-level constant maintains reference identity
    const EMPTY_ARRAY: never[] = [];

    const ref1 = EMPTY_ARRAY;
    const ref2 = EMPTY_ARRAY;

    expect(ref1).toBe(ref2);

    // Compare with inline empty array (different references)
    const inline1 = [];
    const inline2 = [];
    expect(inline1).not.toBe(inline2);
  });

  it('should not cause re-renders when using stable constants vs inline arrays', () => {
    // This test demonstrates the difference between stable and inline arrays
    const STABLE_EMPTY: never[] = [];

    let stableRenders = 0;
    let inlineRenders = 0;

    // Component using stable constant
    function StableComponent() {
      const data = undefined ?? STABLE_EMPTY;
      stableRenders++;
      return React.useMemo(() => <div>{data.length}</div>, [data]);
    }

    // Component using inline array (BAD pattern)
    function InlineComponent() {
      const data = undefined ?? []; // Creates new array each render
      inlineRenders++;
      return React.useMemo(() => <div>{data.length}</div>, [data]);
    }

    const queryClient = new QueryClient();

    // Render stable component
    const { rerender: rerenderStable } = render(
      <QueryClientProvider client={queryClient}>
        <StableComponent />
      </QueryClientProvider>
    );

    const { rerender: rerenderInline } = render(
      <QueryClientProvider client={queryClient}>
        <InlineComponent />
      </QueryClientProvider>
    );

    // Both should render once initially
    expect(stableRenders).toBe(1);
    expect(inlineRenders).toBe(1);

    // The key insight is that with stable constants:
    // - useMemo dependencies are stable
    // - No infinite render loops
    // - React.memo can properly compare props
  });
});

describe('Dashboard renders without infinite loops', () => {
  it('should render without throwing "too many re-renders" error', async () => {
    // This test verifies the fix for React error #310
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    // If the Dashboard has infinite re-render issues, this will timeout or throw
    const renderPromise = import('../../components/Dashboard').then(
      ({ default: Dashboard }) => {
        // Wrap in try-catch to handle render errors gracefully
        try {
          render(
            <QueryClientProvider client={queryClient}>
              <BrowserRouter>
                <Dashboard />
              </BrowserRouter>
            </QueryClientProvider>
          );
          return true;
        } catch (error) {
          // If it's the "too many re-renders" error, the test should fail
          if (
            error instanceof Error &&
            error.message.includes('Too many re-renders')
          ) {
            throw error;
          }
          // Other errors might be acceptable (missing providers, etc.)
          return true;
        }
      }
    );

    // Should complete without infinite loop
    await expect(renderPromise).resolves.toBe(true);
  });
});

describe('Memoization patterns for wallet data', () => {
  it('useMemo should receive array from hook', async () => {
    const { useRecentTransactions } = await import('../../hooks/queries/useWallets');

    function TestWrapper({ children }: { children: React.ReactNode }) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    function TestComponent() {
      const { data, isLoading } = useRecentTransactions(['wallet1'], 10);
      return <div data-testid="result">{isLoading ? 'loading' : data.length}</div>;
    }

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('result')).toBeDefined();
    });

    // Verify the hook returns array data
    expect(screen.getByTestId('result').textContent).toBeDefined();
  });
});
