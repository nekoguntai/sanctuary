import { describe, expect, it } from 'vitest';

import {
  buildDeviceAccessWhere,
  buildWalletAccessWhere,
} from '../../../src/repositories/accessControl';

describe('repository accessControl helpers', () => {
  it('buildWalletAccessWhere includes direct and group membership access', () => {
    expect(buildWalletAccessWhere('user-1')).toEqual({
      OR: [
        { users: { some: { userId: 'user-1' } } },
        { group: { members: { some: { userId: 'user-1' } } } },
      ],
    });
  });

  it('buildDeviceAccessWhere includes owner, shared, group, and wallet-derived access', () => {
    expect(buildDeviceAccessWhere('user-2')).toEqual({
      OR: [
        { userId: 'user-2' },
        { users: { some: { userId: 'user-2' } } },
        { group: { members: { some: { userId: 'user-2' } } } },
        {
          wallets: {
            some: {
              wallet: {
                OR: [
                  { users: { some: { userId: 'user-2' } } },
                  { group: { members: { some: { userId: 'user-2' } } } },
                ],
              },
            },
          },
        },
      ],
    });
  });
});
