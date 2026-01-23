import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransactionFlowPreview } from '../../components/TransactionFlowPreview';

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
    formatFiat: (sats: number) => `$${(sats / 100000).toFixed(2)}`,
    showFiat: true,
  }),
}));

describe('TransactionFlowPreview', () => {
  it('returns null when no inputs and outputs', () => {
    const { container } = render(
      <TransactionFlowPreview
        inputs={[]}
        outputs={[]}
        fee={0}
        feeRate={1}
        totalInput={0}
        totalOutput={0}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders inputs, outputs, fee, and totals', () => {
    render(
      <TransactionFlowPreview
        inputs={[{ txid: 'tx1', vout: 0, address: 'bc1q1234567890abcdef', amount: 50000, label: 'Savings' }]}
        outputs={[
          { address: 'bc1qoutput1', amount: 30000 },
          { address: 'bc1qchange1', amount: 18000, isChange: true, label: 'Change' },
        ]}
        fee={2000}
        feeRate={5}
        totalInput={50000}
        totalOutput={48000}
        isEstimate={true}
      />
    );

    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('(est.)')).toBeInTheDocument();
    expect(screen.getByText('1 in')).toBeInTheDocument();
    expect(screen.getByText('2 out')).toBeInTheDocument();
    expect(screen.getByText('~50000 sats')).toBeInTheDocument();
    expect(screen.getByText('~30000 sats')).toBeInTheDocument();
    expect(screen.getByText('~18000 sats')).toBeInTheDocument();
    expect(screen.getByText('Fee (5 sat/vB)')).toBeInTheDocument();
    expect(screen.getByText('~2000 sats')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('change')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getByText('~50000 sats')).toBeInTheDocument();
    expect(screen.getByText('~48000 sats')).toBeInTheDocument();
  });
});
