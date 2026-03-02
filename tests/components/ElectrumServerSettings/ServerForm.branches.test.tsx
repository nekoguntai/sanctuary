import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ServerForm } from '../../../components/ElectrumServerSettings/ServerForm';

const baseServer = {
  label: 'Primary',
  host: 'electrum.example.com',
  port: 50002,
  useSsl: true,
};

const renderForm = (overrides: Partial<React.ComponentProps<typeof ServerForm>> = {}) => {
  const onNewServerChange = vi.fn();
  const onSubmit = vi.fn();
  const onCancel = vi.fn();

  const view = render(
    <ServerForm
      editingServerId={null}
      newServer={baseServer}
      onNewServerChange={onNewServerChange}
      onSubmit={onSubmit}
      onCancel={onCancel}
      isLoading={false}
      {...overrides}
    />,
  );

  return { ...view, onNewServerChange, onSubmit, onCancel };
};

describe('ServerForm branch coverage', () => {
  it('covers add vs edit title/button label branches', () => {
    const { rerender } = renderForm({ editingServerId: null });

    expect(screen.getByText('Add New Server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Server/i })).toBeInTheDocument();

    rerender(
      <ServerForm
        editingServerId="server-1"
        newServer={baseServer}
        onNewServerChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.getByText('Edit Server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update Server/i })).toBeInTheDocument();
  });

  it('covers input handlers, port parse fallback, protocol branch, and actions', () => {
    const { onNewServerChange, onSubmit, onCancel, rerender } = renderForm();

    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Backup' } });
    fireEvent.change(screen.getByPlaceholderText('electrum.example.com'), { target: { value: 'host.backup' } });

    const portInput = screen.getByRole('spinbutton');
    fireEvent.change(portInput, { target: { value: '60001' } });
    fireEvent.change(portInput, { target: { value: '0' } });

    const protocolSelect = screen.getByRole('combobox');
    fireEvent.change(protocolSelect, { target: { value: 'tcp' } });
    fireEvent.change(protocolSelect, { target: { value: 'ssl' } });

    // Rerender with tcp selected to cover value branch
    rerender(
      <ServerForm
        editingServerId={null}
        newServer={{ ...baseServer, useSsl: false }}
        onNewServerChange={onNewServerChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        isLoading={false}
      />,
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('tcp');

    expect(onNewServerChange).toHaveBeenCalledWith(expect.objectContaining({ label: 'Backup' }));
    expect(onNewServerChange).toHaveBeenCalledWith(expect.objectContaining({ host: 'host.backup' }));
    expect(onNewServerChange).toHaveBeenCalledWith(expect.objectContaining({ port: 60001 }));
    expect(onNewServerChange).toHaveBeenCalledWith(expect.objectContaining({ port: 50002 }));
    expect(onNewServerChange).toHaveBeenCalledWith(expect.objectContaining({ useSsl: false }));
    expect(onNewServerChange).toHaveBeenCalledWith(expect.objectContaining({ useSsl: true }));

    fireEvent.click(screen.getByRole('button', { name: /Add Server/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
