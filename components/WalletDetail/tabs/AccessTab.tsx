/**
 * AccessTab - Wallet access management with ownership, sharing, and transfers
 *
 * Provides three sub-tabs for managing wallet access:
 * - Ownership: view current owner, initiate ownership transfer
 * - Sharing: add/remove group and individual user access
 * - Transfers: view and manage pending ownership transfers
 */

import React from 'react';
import { Users, Send, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { PendingTransfersPanel } from '../../PendingTransfersPanel';
import type { User } from '../../../types';
import type { WalletShareInfo } from '../../../src/api/wallets';
import type { UserGroup, SearchUser } from '../../../src/api/auth';
import type { AccessSubTab } from '../types';

interface AccessTabProps {
  accessSubTab: AccessSubTab;
  onAccessSubTabChange: (tab: AccessSubTab) => void;
  walletShareInfo: WalletShareInfo | null;
  userRole: string;
  user: User | null;
  onShowTransferModal: () => void;
  selectedGroupToAdd: string;
  onSelectedGroupToAddChange: (groupId: string) => void;
  groups: UserGroup[];
  sharingLoading: boolean;
  onAddGroup: (role: 'viewer' | 'signer') => void;
  onUpdateGroupRole: (role: 'viewer' | 'signer') => void;
  onRemoveGroup: () => void;
  userSearchQuery: string;
  onSearchUsers: (query: string) => void;
  searchingUsers: boolean;
  userSearchResults: SearchUser[];
  onShareWithUser: (userId: string, role: 'viewer' | 'signer') => void;
  onRemoveUserAccess: (userId: string) => void;
  walletId: string;
  onTransferComplete: () => void;
}

export const AccessTab: React.FC<AccessTabProps> = ({
  accessSubTab,
  onAccessSubTabChange,
  walletShareInfo,
  userRole,
  user,
  onShowTransferModal,
  selectedGroupToAdd,
  onSelectedGroupToAddChange,
  groups,
  sharingLoading,
  onAddGroup,
  onUpdateGroupRole,
  onRemoveGroup,
  userSearchQuery,
  onSearchUsers,
  searchingUsers,
  userSearchResults,
  onShareWithUser,
  onRemoveUserAccess,
  walletId,
  onTransferComplete,
}) => {
  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex space-x-1 p-1 surface-secondary rounded-lg w-fit">
        {(['ownership', 'sharing', 'transfers'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onAccessSubTabChange(tab)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
              accessSubTab === tab
                ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Ownership Sub-tab */}
      {accessSubTab === 'ownership' && (
        <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
            <div className="flex items-center">
              <div className="h-9 w-9 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-base font-bold text-sanctuary-600 dark:text-sanctuary-300">
                {walletShareInfo?.users.find(u => u.role === 'owner')?.username?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="ml-3">
                <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  {walletShareInfo?.users.find(u => u.role === 'owner')?.username || user?.username || 'You'}
                </p>
                <p className="text-xs text-sanctuary-500">Wallet Owner</p>
              </div>
            </div>
            {userRole === 'owner' && (
              <button
                onClick={onShowTransferModal}
                className="flex items-center px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
              >
                <Send className="w-4 h-4 mr-1.5" />
                Transfer
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sharing Sub-tab */}
      {accessSubTab === 'sharing' && (
        <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800 space-y-4">
          {/* Add sharing controls - only for owners */}
          {userRole === 'owner' && (
            <div className="p-3 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
              <div className="flex flex-wrap gap-2">
                {/* Group sharing */}
                {!walletShareInfo?.group && (
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedGroupToAdd}
                      onChange={(e) => onSelectedGroupToAddChange(e.target.value)}
                      className="text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                    >
                      <option value="">Add group...</option>
                      {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    {selectedGroupToAdd && (
                      <>
                        <button
                          onClick={() => onAddGroup('viewer')}
                          disabled={sharingLoading}
                          className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
                        >
                          Viewer
                        </button>
                        <button
                          onClick={() => onAddGroup('signer')}
                          disabled={sharingLoading}
                          className="text-xs px-2 py-1 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50 transition-colors disabled:opacity-50"
                        >
                          Signer
                        </button>
                      </>
                    )}
                  </div>
                )}
                {/* User sharing */}
                <div className="flex-1 min-w-[200px] relative">
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => onSearchUsers(e.target.value)}
                    placeholder="Add user..."
                    className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                  />
                  {searchingUsers && (
                    <div className="absolute right-2 top-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent" />
                    </div>
                  )}
                  {userSearchResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {userSearchResults.map(u => (
                        <div key={u.id} className="px-2 py-1.5 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 flex items-center justify-between">
                          <div className="flex items-center">
                            <div className="h-5 w-5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                              {u.username.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm">{u.username}</span>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => onShareWithUser(u.id, 'viewer')} disabled={sharingLoading} className="text-xs px-1.5 py-0.5 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 disabled:opacity-50">View</button>
                            <button onClick={() => onShareWithUser(u.id, 'signer')} disabled={sharingLoading} className="text-xs px-1.5 py-0.5 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50 disabled:opacity-50">Sign</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Current shared access */}
          <div className="space-y-2">
            {/* Group */}
            {walletShareInfo?.group && (
              <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                <div className="flex items-center">
                  <Users className="w-4 h-4 text-sanctuary-500 mr-2" />
                  <span className="text-sm font-medium">{walletShareInfo.group.name}</span>
                  {userRole === 'owner' ? (
                    <select
                      value={walletShareInfo.group.role}
                      onChange={(e) => onUpdateGroupRole(e.target.value as 'viewer' | 'signer')}
                      disabled={sharingLoading}
                      className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full border-none cursor-pointer"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="signer">Signer</option>
                    </select>
                  ) : (
                    <span className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full capitalize">{walletShareInfo.group.role}</span>
                  )}
                </div>
                {userRole === 'owner' && (
                  <button onClick={onRemoveGroup} disabled={sharingLoading} className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Individual users */}
            {walletShareInfo?.users.filter(u => u.role !== 'owner').map(u => (
              <div key={u.id} className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                <div className="flex items-center">
                  <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium">{u.username}</span>
                  {userRole === 'owner' ? (
                    <select
                      value={u.role}
                      onChange={(e) => onShareWithUser(u.id, e.target.value as 'viewer' | 'signer')}
                      disabled={sharingLoading}
                      className="ml-2 text-xs bg-transparent border-none p-0 text-sanctuary-500 capitalize cursor-pointer"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="signer">Signer</option>
                    </select>
                  ) : (
                    <span className="ml-2 text-xs text-sanctuary-500 capitalize">{u.role}</span>
                  )}
                </div>
                {userRole === 'owner' && (
                  <button onClick={() => onRemoveUserAccess(u.id)} disabled={sharingLoading} className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}

            {/* Empty state */}
            {!walletShareInfo?.group && (!walletShareInfo?.users || walletShareInfo.users.filter(u => u.role !== 'owner').length === 0) && (
              <div className="text-center py-6 text-sanctuary-400 text-sm">
                Not shared with anyone yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transfers Sub-tab */}
      {accessSubTab === 'transfers' && (
        <PendingTransfersPanel
          resourceType="wallet"
          resourceId={walletId}
          onTransferComplete={onTransferComplete}
        />
      )}
    </div>
  );
};
