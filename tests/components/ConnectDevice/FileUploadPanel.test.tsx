import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileUploadPanel } from '../../../components/ConnectDevice/FileUploadPanel';

const baseModel = {
  id: 'coldcard-mk4',
  slug: 'coldcard-mk4',
  name: 'Coldcard MK4',
  manufacturer: 'Coinkite',
  connectivity: ['sd_card'],
  airGapped: true,
  secureElement: true,
  openSource: true,
  supportsBitcoinOnly: true,
  integrationTested: true,
} as any;

describe('FileUploadPanel', () => {
  it('renders initial state and handles file upload', () => {
    const onFileUpload = vi.fn();
    const { container } = render(
      <FileUploadPanel
        selectedModel={baseModel}
        scanning={false}
        scanned={false}
        onFileUpload={onFileUpload}
      />
    );

    expect(screen.getByText(/Upload the export file from your Coldcard MK4/i)).toBeInTheDocument();
    expect(screen.getByText('Select File')).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput, { target: { files: [new File(['{}'], 'wallet.json', { type: 'application/json' })] } });

    expect(onFileUpload).toHaveBeenCalledTimes(1);
  });

  it('renders scanning state', () => {
    render(
      <FileUploadPanel
        selectedModel={baseModel}
        scanning
        scanned={false}
        onFileUpload={vi.fn()}
      />
    );

    expect(screen.getByText(/Parsing file/i)).toBeInTheDocument();
    expect(screen.queryByText('Select File')).not.toBeInTheDocument();
  });

  it('renders success state', () => {
    render(
      <FileUploadPanel
        selectedModel={baseModel}
        scanning={false}
        scanned
        onFileUpload={vi.fn()}
      />
    );

    expect(screen.getByText(/File Imported Successfully/i)).toBeInTheDocument();
  });
});

