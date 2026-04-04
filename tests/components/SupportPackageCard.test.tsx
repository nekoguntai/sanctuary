/**
 * Tests for SupportPackageCard component
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportPackageCard } from '../../components/SystemSettings/SupportPackageCard';
import * as supportPackageApi from '../../src/api/admin/supportPackage';

// Mock the support package API module
vi.mock('../../src/api/admin/supportPackage', () => ({
  downloadSupportPackage: vi.fn(),
}));

describe('SupportPackageCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supportPackageApi.downloadSupportPackage).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders the card with title, description, and button', () => {
      render(<SupportPackageCard />);

      expect(screen.getByText('Support Package')).toBeInTheDocument();
      expect(
        screen.getByText(/Generate a diagnostic bundle to share with developers/)
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Generate & Download/ })
      ).toBeInTheDocument();
    });
  });

  describe('generating support package', () => {
    it('shows loading state when generating', async () => {
      // Make the API call hang so we can observe the loading state
      vi.mocked(supportPackageApi.downloadSupportPackage).mockImplementation(
        () => new Promise(() => {})
      );

      const user = userEvent.setup();
      render(<SupportPackageCard />);

      const button = screen.getByRole('button', { name: /Generate & Download/ });
      await user.click(button);

      // Button should be disabled while loading
      expect(button).toBeDisabled();
    });

    it('shows success message after successful download', async () => {
      const user = userEvent.setup();
      render(<SupportPackageCard />);

      await user.click(screen.getByRole('button', { name: /Generate & Download/ }));

      await waitFor(() => {
        expect(
          screen.getByText('Support package downloaded successfully.')
        ).toBeInTheDocument();
      });
    });

    it('shows error message on failure', async () => {
      vi.mocked(supportPackageApi.downloadSupportPackage).mockRejectedValue(
        new Error('Server error')
      );

      const user = userEvent.setup();
      render(<SupportPackageCard />);

      await user.click(screen.getByRole('button', { name: /Generate & Download/ }));

      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });

    it('clears success message on re-click', async () => {
      const user = userEvent.setup();
      render(<SupportPackageCard />);

      // First click: triggers success
      await user.click(screen.getByRole('button', { name: /Generate & Download/ }));
      await waitFor(() => {
        expect(
          screen.getByText('Support package downloaded successfully.')
        ).toBeInTheDocument();
      });

      // Second click: success should be cleared initially, then re-appear on completion
      // Make the second call hang so we can observe the cleared state
      vi.mocked(supportPackageApi.downloadSupportPackage).mockImplementation(
        () => new Promise(() => {})
      );

      await user.click(screen.getByRole('button', { name: /Generate & Download/ }));

      await waitFor(() => {
        expect(
          screen.queryByText('Support package downloaded successfully.')
        ).not.toBeInTheDocument();
      });
    });

    it('clears error message on re-click', async () => {
      // First click: fails
      vi.mocked(supportPackageApi.downloadSupportPackage).mockRejectedValue(
        new Error('Network failure')
      );

      const user = userEvent.setup();
      render(<SupportPackageCard />);

      await user.click(screen.getByRole('button', { name: /Generate & Download/ }));
      await waitFor(() => {
        expect(screen.getByText('Network failure')).toBeInTheDocument();
      });

      // Second click: make it hang so we can check error was cleared
      vi.mocked(supportPackageApi.downloadSupportPackage).mockImplementation(
        () => new Promise(() => {})
      );

      await user.click(screen.getByRole('button', { name: /Generate & Download/ }));

      await waitFor(() => {
        expect(screen.queryByText('Network failure')).not.toBeInTheDocument();
      });
    });
  });
});
