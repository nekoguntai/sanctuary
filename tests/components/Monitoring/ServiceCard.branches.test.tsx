import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceCard } from '../../../components/Monitoring/ServiceCard';

const serviceBase = {
  id: 'grafana',
  name: 'Grafana',
  description: 'Dashboards',
  url: 'http://grafana.example.com:3000',
  defaultPort: 3000,
  icon: 'UnknownIcon',
  isCustomUrl: false,
  status: 'healthy' as const,
};

describe('Monitoring ServiceCard branch coverage', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  it('covers password copy states, timeout replacement, and cleanup on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const { unmount } = render(
      <ServiceCard
        service={{ ...serviceBase, url: 'http://{host}:3000' }}
        onEditUrl={vi.fn()}
        hostname="node.local"
        credentials={{
          username: 'admin',
          password: 'secret',
          passwordSource: 'GRAFANA_PASSWORD',
          hasAuth: true,
        }}
      />
    );

    // Fallback icon map branch uses Activity when icon is unknown.
    expect(document.querySelector('.lucide-activity')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/i })).toHaveAttribute('href', 'http://node.local:3000');

    const copyButton = screen.getByTitle('Copy password');
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret');
    });
    expect(screen.getByTitle('Copied!')).toBeInTheDocument();

    // Second copy while timeout exists exercises clearTimeout(copyTimeoutRef.current).
    fireEvent.click(screen.getByTitle('Copied!'));
    expect(clearTimeoutSpy).toHaveBeenCalled();

    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('covers no-op copy path when credentials.password is empty', () => {
    render(
      <ServiceCard
        service={serviceBase}
        onEditUrl={vi.fn()}
        hostname="node.local"
        credentials={{
          username: 'admin',
          password: '',
          passwordSource: 'GRAFANA_PASSWORD',
          hasAuth: true,
        }}
      />
    );

    fireEvent.click(screen.getByTitle('Copy password'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
