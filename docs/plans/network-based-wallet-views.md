# Network-Based Wallet Views Plan

## Overview

Refactor the Wallet Overview page to display wallets grouped by network type (mainnet, testnet, signet), with network-specific balance totals, filtered wallet lists, and batch sync operations.

---

## Current State

### Dashboard.tsx (Wallet Overview)
- Shows **all wallets** regardless of network in a single list
- Total balance is sum of **all wallets** across all networks
- Wallet table includes columns: Name, Type, Sync Status, Balance
- No network column currently (that's in WalletList.tsx)

### WalletList.tsx (Wallet Management)
- Has Network column with color-coded badges
- Supports sorting by network
- Grid and table view modes

### Database
- Wallet model has `network` field: `'mainnet' | 'testnet' | 'signet' | 'regtest'`
- Already indexed and queryable

### Sync API
- `POST /api/v1/sync/wallet/:walletId` - Sync single wallet
- `POST /api/v1/sync/user` - Queue all user's wallets
- `POST /api/v1/sync/resync/:walletId` - Full resync single wallet
- No network-filtered batch sync endpoints currently

---

## Proposed Design

### 1. Network Selector Tabs

Add a tab bar at the top of the Wallet Overview page:

```
┌─────────────────────────────────────────────────────────────┐
│  [Mainnet]  [Testnet]  [Signet]                             │
│     ●           ○          ○                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Total Balance: 1.234 BTC                                   │
│  (Network-specific total)                                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Wallet List (filtered by selected network)          │   │
│  │                                                      │   │
│  │ Name          Type        Sync Status    Balance    │   │
│  │ ─────────────────────────────────────────────────── │   │
│  │ Savings       Single Sig  ✓ Synced       0.5 BTC    │   │
│  │ Cold Storage  Multisig    ✓ Synced       0.734 BTC  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Sync All Mainnet]  [Full Resync All Mainnet]             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. Tab Design Details

| Network | Color | Icon | Badge |
|---------|-------|------|-------|
| Mainnet | Emerald/Green | Bitcoin logo | Default (no badge needed) |
| Testnet | Amber/Orange | Flask/beaker | "Testnet" warning |
| Signet | Purple | Shield/lock | "Signet" badge |

**Tab Behavior:**
- Selected tab is highlighted with network color
- Tabs show wallet count: `Mainnet (5)`, `Testnet (2)`, `Signet (0)`
- Tabs with 0 wallets are dimmed but still accessible
- Default to Mainnet on page load
- Persist selected network in URL query param (`?network=testnet`) or localStorage

### 3. Network-Specific Balance

**Current behavior:**
```typescript
const totalBalance = wallets.reduce((acc, w) => acc + w.balance, 0);
```

**New behavior:**
```typescript
const filteredWallets = wallets.filter(w => w.network === selectedNetwork);
const networkBalance = filteredWallets.reduce((acc, w) => acc + w.balance, 0);
```

**Balance chart:**
- Only shows history for wallets of the selected network
- `useBalanceHistory` hook receives filtered wallet IDs

### 4. Wallet Table Changes

**Remove Network column** (implicit from tab selection):

| Current Columns | New Columns |
|-----------------|-------------|
| Name | Name |
| Type | Type |
| Network | ~~Removed~~ |
| Sync Status | Sync Status |
| Balance | Balance |

**Mobile considerations:**
- More space for Name column on narrow screens
- Balance always visible

### 5. Sync All / Full Resync All Buttons

Add action buttons below the wallet table:

```
┌─────────────────────────────────────────────────────────┐
│                     Sync Actions                         │
├─────────────────────────────────────────────────────────┤
│  [🔄 Sync All Mainnet Wallets]                          │
│                                                          │
│  [⚠️ Full Resync All Mainnet Wallets]                   │
│  (Warning: This will clear and rebuild all wallet data) │
└─────────────────────────────────────────────────────────┘
```

**Button states:**
- Disabled when no wallets exist for the network
- Shows spinner + "Syncing..." when operation in progress
- Shows progress indicator: "Syncing 3 of 5 wallets..."

**Full Resync warning dialog:**
```
┌─────────────────────────────────────────────────────────┐
│  ⚠️ Full Resync All Mainnet Wallets                     │
├─────────────────────────────────────────────────────────┤
│  This will:                                              │
│  • Clear all transaction history for 5 wallets          │
│  • Clear all UTXO data                                  │
│  • Re-derive all addresses                              │
│  • Re-sync from the blockchain                          │
│                                                          │
│  This may take several minutes.                         │
│                                                          │
│  [Cancel]                    [Resync All Wallets]       │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Frontend - Network Tabs & Filtering

**Files to modify:**
- `components/Dashboard.tsx`

**Changes:**
1. Add `useState` for `selectedNetwork` with type `'mainnet' | 'testnet' | 'signet'`
2. Create `NetworkTabs` component with styled tab buttons
3. Filter `wallets` array by `selectedNetwork` before rendering
4. Update `totalBalance` calculation to use filtered wallets
5. Update `useBalanceHistory` to receive filtered wallet IDs
6. Remove Network column from table (if present)
7. Update wallet distribution bar to show filtered wallets only

**New component: `NetworkTabs.tsx`**
```typescript
interface NetworkTabsProps {
  selectedNetwork: NetworkType;
  onNetworkChange: (network: NetworkType) => void;
  walletCounts: Record<NetworkType, number>;
}
```

### Phase 2: Backend - Network-Filtered Sync Endpoints

**Files to modify:**
- `server/src/api/sync.ts`
- `server/src/services/syncService.ts`

**New API endpoints:**
```
POST /api/v1/sync/network/:network
  - Queue sync for all user's wallets of specified network
  - Returns: { queued: number, walletIds: string[] }

POST /api/v1/sync/network/:network/resync
  - Full resync for all user's wallets of specified network
  - Requires confirmation header: X-Confirm-Resync: true
  - Returns: { queued: number, walletIds: string[] }

GET /api/v1/sync/network/:network/status
  - Get aggregate sync status for network
  - Returns: { total: number, syncing: number, synced: number, failed: number }
```

**Service changes:**
```typescript
// syncService.ts
async queueNetworkWallets(userId: string, network: NetworkType, priority: Priority): Promise<string[]>
async resyncNetworkWallets(userId: string, network: NetworkType): Promise<string[]>
```

### Phase 3: Frontend - Sync Action Buttons

**Files to modify:**
- `components/Dashboard.tsx`
- `src/api/sync.ts`

**Changes:**
1. Add `NetworkSyncActions` component with two buttons
2. Add API client methods:
   ```typescript
   syncNetworkWallets(network: NetworkType): Promise<SyncResponse>
   resyncNetworkWallets(network: NetworkType): Promise<SyncResponse>
   ```
3. Add confirmation dialog for full resync
4. Add progress tracking UI (syncing X of Y)
5. Handle button states (disabled, loading, success, error)

### Phase 4: URL State & Persistence

**Files to modify:**
- `components/Dashboard.tsx`
- Potentially router configuration

**Changes:**
1. Sync selected network to URL: `/dashboard?network=testnet`
2. Read network from URL on page load
3. Fallback to localStorage if no URL param
4. Update browser history on tab change (optional: use `replaceState`)

### Phase 5: Polish & Edge Cases

**Considerations:**
1. Empty state for networks with no wallets:
   ```
   "No testnet wallets yet. Import or create a testnet wallet to get started."
   [Create Testnet Wallet] [Import Testnet Wallet]
   ```

2. WebSocket subscription filtering:
   - Only play notification sounds for active network's wallets
   - Or show subtle indicator for other network activity

3. Recent Activity section:
   - Filter to show only selected network's transactions
   - Or add network badge to each transaction row

4. Wallet distribution bar:
   - Show only selected network's wallets
   - Maintain consistent colors per wallet

5. Price display:
   - Mainnet: Show real BTC price
   - Testnet/Signet: Show "Test BTC" or hide fiat value

---

## Files to Modify

### Frontend (Modify)
| File | Changes |
|------|---------|
| `components/Dashboard.tsx` | Add network tabs, filter wallets, sync buttons |
| `src/api/sync.ts` | Add network sync API methods |
| `types.ts` | Add NetworkSyncStatus type if needed |

### Frontend (New)
| File | Purpose |
|------|---------|
| `components/NetworkTabs.tsx` | Reusable network tab selector |
| `components/NetworkSyncActions.tsx` | Sync All / Resync All buttons |

### Backend (Modify)
| File | Changes |
|------|---------|
| `server/src/api/sync.ts` | Add network-filtered sync endpoints |
| `server/src/services/syncService.ts` | Add network sync methods |

---

## API Changes Summary

### New Endpoints

```
POST /api/v1/sync/network/:network
POST /api/v1/sync/network/:network/resync
GET  /api/v1/sync/network/:network/status
```

### Request/Response Types

```typescript
// POST /api/v1/sync/network/:network
interface NetworkSyncRequest {
  priority?: 'high' | 'normal' | 'low';
}

interface NetworkSyncResponse {
  success: boolean;
  queued: number;
  walletIds: string[];
}

// GET /api/v1/sync/network/:network/status
interface NetworkSyncStatus {
  network: NetworkType;
  total: number;
  syncing: number;
  synced: number;
  failed: number;
  lastSyncAt?: string;
}
```

---

## UI Mockup (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SANCTUARY                                              [Settings] [?]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │  Mainnet    │  │  Testnet    │  │  Signet     │                     │
│  │    (5)      │  │    (2)      │  │    (0)      │                     │
│  └──────●──────┘  └─────────────┘  └─────────────┘                     │
│        ▲ selected                                                       │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Total Balance                              [$45,234.00 USD]     │  │
│  │  ₿ 1.23456789                                                    │  │
│  │  ▁▂▃▄▅▆▇█▇▆▅▆▇█▇▆▅▄▃▄▅▆▇█  [1D] [1W] [1M] [1Y] [ALL]            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Wallets                                                          │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  ● Savings              Single Sig    ✓ Synced      0.50000000   │  │
│  │  ● Cold Storage         Multisig      ✓ Synced      0.73456789   │  │
│  │  ● Daily Spending       Single Sig    ⟳ Syncing     0.00000000   │  │
│  │  ● Business Account     Multisig      ✓ Synced      0.00000000   │  │
│  │  ● Hardware Wallet      Single Sig    ✓ Synced      0.00000000   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  🔄 Sync All Mainnet    │  │  ⚠️ Full Resync All Mainnet        │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Recent Activity (Mainnet)                                        │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  ↓ Received  +0.001 BTC   Savings           2 hours ago          │  │
│  │  ↑ Sent      -0.005 BTC   Cold Storage      1 day ago            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Open Questions

1. **Regtest support?**
   - Include regtest as a fourth tab, or hide it entirely?
   - Regtest is typically only used for development

2. **Cross-network notifications?**
   - When viewing Mainnet, should Testnet transaction sounds still play?
   - Option: Show subtle badge on other tabs indicating activity

3. **Default network preference?**
   - Always default to Mainnet?
   - Remember last viewed network per user?

4. **Fiat display for testnets?**
   - Hide fiat values for testnet/signet (no real value)?
   - Show "tBTC" label instead of "BTC"?

5. **Sync All behavior?**
   - Queue all at once, or stagger to avoid overwhelming the server?
   - Show individual wallet progress or just overall count?

---

## Estimated Scope

- **Frontend changes**: ~4 files modified, ~2 new components
- **Backend changes**: ~2 files modified
- **New API endpoints**: 3
- **Database changes**: None (network field already exists)
- **Breaking changes**: None

---

## Success Criteria

1. User can switch between Mainnet/Testnet/Signet tabs
2. Balance and wallet list updates to show only selected network
3. Network column removed from table (implicit from tab)
4. "Sync All" button queues sync for all wallets of selected network
5. "Full Resync All" button with confirmation dialog works
6. Selected network persists across page refreshes
7. Empty state shown when no wallets exist for a network
