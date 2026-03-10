/**
 * Tests for FeatureFlags component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeatureFlags } from '../../components/FeatureFlags';
import * as adminApi from '../../src/api/admin';

vi.mock('../../src/api/admin', () => ({
  getFeatureFlags: vi.fn(),
  updateFeatureFlag: vi.fn(),
  resetFeatureFlag: vi.fn(),
  getFeatureFlagAuditLog: vi.fn(),
}));

describe('FeatureFlags', () => {
  const mockFlags = [
    {
      key: 'aiAssistant',
      enabled: true,
      description: 'AI-powered transaction analysis',
      category: 'general',
      source: 'database' as const,
      modifiedBy: 'admin-1',
      updatedAt: new Date().toISOString(),
    },
    {
      key: 'treasuryAutopilot',
      enabled: false,
      description: 'Enable Treasury Autopilot consolidation jobs',
      category: 'general',
      source: 'database' as const,
      modifiedBy: 'system',
      updatedAt: null,
    },
    {
      key: 'experimental.taprootAddresses',
      enabled: false,
      description: 'Enable Taproot (P2TR) address support',
      category: 'experimental',
      source: 'database' as const,
      modifiedBy: null,
      updatedAt: null,
    },
  ];

  const mockAuditLog = {
    entries: [
      {
        id: 'audit-1',
        key: 'aiAssistant',
        previousValue: false,
        newValue: true,
        changedBy: 'admin-1',
        reason: 'Enable for testing',
        createdAt: new Date().toISOString(),
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getFeatureFlags).mockResolvedValue(mockFlags);
    vi.mocked(adminApi.updateFeatureFlag).mockResolvedValue(mockFlags[0]);
    vi.mocked(adminApi.resetFeatureFlag).mockResolvedValue(mockFlags[0]);
    vi.mocked(adminApi.getFeatureFlagAuditLog).mockResolvedValue(mockAuditLog);
  });

  describe('rendering', () => {
    it('renders header and loading state', async () => {
      render(<FeatureFlags />);

      // Should show loading initially
      expect(screen.getByText('Loading feature flags...')).toBeInTheDocument();

      // Then show the header
      await waitFor(() => {
        expect(screen.getByText('Feature Flags')).toBeInTheDocument();
      });
    });

    it('renders all flags grouped by category', async () => {
      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText('General')).toBeInTheDocument();
        expect(screen.getByText('Experimental')).toBeInTheDocument();
      });

      expect(screen.getByText('aiAssistant')).toBeInTheDocument();
      expect(screen.getByText('treasuryAutopilot')).toBeInTheDocument();
      expect(screen.getByText('experimental.taprootAddresses')).toBeInTheDocument();
    });

    it('renders flag descriptions', async () => {
      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText('AI-powered transaction analysis')).toBeInTheDocument();
        expect(screen.getByText('Enable Treasury Autopilot consolidation jobs')).toBeInTheDocument();
      });
    });

    it('shows side-effect warning for treasuryAutopilot', async () => {
      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText(/starts or stops background consolidation jobs/)).toBeInTheDocument();
      });
    });

    it('shows modified-by info for non-system modifiers', async () => {
      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText(/Modified by admin-1/)).toBeInTheDocument();
      });
    });
  });

  describe('toggle behavior', () => {
    it('calls updateFeatureFlag on toggle click', async () => {
      const user = userEvent.setup();
      vi.mocked(adminApi.updateFeatureFlag).mockResolvedValue({
        ...mockFlags[0],
        enabled: false,
      });

      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText('aiAssistant')).toBeInTheDocument();
      });

      // Find the toggle buttons (there should be one per flag)
      const toggleButtons = screen.getAllByRole('button').filter(
        btn => btn.className.includes('rounded-full') && btn.className.includes('inline-flex')
      );
      expect(toggleButtons.length).toBeGreaterThan(0);

      await user.click(toggleButtons[0]);

      await waitFor(() => {
        expect(adminApi.updateFeatureFlag).toHaveBeenCalledWith('aiAssistant', false);
      });
    });
  });

  describe('reset behavior', () => {
    it('calls resetFeatureFlag on reset click', async () => {
      const user = userEvent.setup();
      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText('aiAssistant')).toBeInTheDocument();
      });

      // Find reset buttons (by title)
      const resetButtons = screen.getAllByTitle('Reset to environment default');
      expect(resetButtons.length).toBeGreaterThan(0);

      await user.click(resetButtons[0]);

      await waitFor(() => {
        expect(adminApi.resetFeatureFlag).toHaveBeenCalledWith('aiAssistant');
      });
    });
  });

  describe('audit log', () => {
    it('loads and shows audit log on expand', async () => {
      const user = userEvent.setup();
      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText('Change History')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Change History'));

      await waitFor(() => {
        expect(adminApi.getFeatureFlagAuditLog).toHaveBeenCalled();
        expect(screen.getByText('enabled')).toBeInTheDocument();
        expect(screen.getByText('Enable for testing')).toBeInTheDocument();
      });
    });

    it('shows empty state when no audit entries', async () => {
      vi.mocked(adminApi.getFeatureFlagAuditLog).mockResolvedValue({
        entries: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      const user = userEvent.setup();
      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText('Change History')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Change History'));

      await waitFor(() => {
        expect(screen.getByText('No changes recorded yet.')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error message on toggle failure', async () => {
      const user = userEvent.setup();
      vi.mocked(adminApi.updateFeatureFlag).mockRejectedValue(new Error('Network error'));

      render(<FeatureFlags />);

      await waitFor(() => {
        expect(screen.getByText('aiAssistant')).toBeInTheDocument();
      });

      const toggleButtons = screen.getAllByRole('button').filter(
        btn => btn.className.includes('rounded-full') && btn.className.includes('inline-flex')
      );
      await user.click(toggleButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });
});
