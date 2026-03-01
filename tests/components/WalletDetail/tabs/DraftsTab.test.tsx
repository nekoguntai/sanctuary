import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftsTab } from '../../../../components/WalletDetail/tabs/DraftsTab';

const mockRefs = vi.hoisted(() => ({
  draftListProps: null as any,
}));

vi.mock('../../../../components/DraftList', () => ({
  DraftList: (props: any) => {
    mockRefs.draftListProps = props;
    return <div data-testid="draft-list" />;
  },
}));

describe('DraftsTab', () => {
  it('maps quorum and edit permissions into DraftList props', () => {
    const onDraftsChange = vi.fn();

    render(
      <DraftsTab
        walletId="wallet-1"
        walletType="multi_sig" as any
        quorum={2}
        totalSigners={3}
        userRole="owner"
        addresses={[{ id: 'addr-1', address: 'bc1qabc' } as any]}
        walletName="Treasury"
        onDraftsChange={onDraftsChange}
      />
    );

    expect(screen.getByTestId('draft-list')).toBeInTheDocument();
    expect(mockRefs.draftListProps.walletId).toBe('wallet-1');
    expect(mockRefs.draftListProps.walletType).toBe('multi_sig');
    expect(mockRefs.draftListProps.quorum).toEqual({ m: 2, n: 3 });
    expect(mockRefs.draftListProps.canEdit).toBe(true);
    expect(mockRefs.draftListProps.walletName).toBe('Treasury');
    expect(mockRefs.draftListProps.onDraftsChange).toBe(onDraftsChange);
  });

  it('disables editing for viewers and handles missing quorum', () => {
    render(
      <DraftsTab
        walletId="wallet-2"
        walletType="single_sig" as any
        userRole="viewer"
        addresses={[]}
        walletName="Watch-Only"
        onDraftsChange={vi.fn()}
      />
    );

    expect(mockRefs.draftListProps.canEdit).toBe(false);
    expect(mockRefs.draftListProps.quorum).toBeUndefined();
  });
});
