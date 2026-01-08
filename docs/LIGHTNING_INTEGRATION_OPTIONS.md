# Lightning & Taproot Assets Integration Options

> Future reference document for integrating Lightning Network and Taproot Assets into Sanctuary.

## Executive Summary

**Recommendation:** Build Lightning as a separate service ("Beacon") that integrates with Sanctuary via API. This maintains Sanctuary's non-custodial security model while enabling Lightning functionality with appropriate security controls.

---

## Part 1: Lightning Network Integration Options

### Option A: Submarine Swaps (Zero Custody)

**How it works:** Users pay Lightning invoices using on-chain BTC through atomic swaps. No Lightning channels or hot keys on Sanctuary.

```
User's Hardware Wallet → On-chain BTC → Swap Provider → Lightning Invoice Paid
```

**Integration approach:**
- Integrate with Boltz Exchange API or run Boltz backend
- User initiates "pay Lightning invoice" from their cold storage
- Swap is atomic - no trust required beyond the swap timeout

**Pros:**
- Zero secrets held
- Works with existing hardware wallet flow
- Simple to implement

**Cons:**
- Higher fees (swap premium + on-chain fee)
- Slower (requires on-chain confirmation)
- No receiving Lightning payments
- Not a "true" Lightning experience

---

### Option B: LSP Integration (Minimal Custody)

**How it works:** Partner with Lightning Service Providers. Users connect external wallets or use LSP-hosted nodes. Sanctuary acts as coordinator/UI.

```
Sanctuary (UI/Coordination) ←→ LSP API (Breez SDK, Greenlight, Voltage)
                                    ↓
                              User's Lightning Node
```

**Integration options:**
1. **Breez SDK** - Non-custodial, handles liquidity automatically
2. **Greenlight (Blockstream)** - User's keys on their device, node in cloud
3. **Voltage** - API-managed nodes

**Pros:**
- Keys can stay on user devices
- Production-ready infrastructure
- Handles liquidity/channel management

**Cons:**
- Third-party dependency
- Variable trust models
- Monthly costs for hosted nodes

---

### Option C: Remote Signing LND (Partial Custody)

**How it works:** Run LND in "remote signer" mode. Critical keys live on HSM or could potentially use hardware wallet (experimental). Sanctuary manages channels and routing.

```
┌─────────────────────────────────────────┐
│ Sanctuary Server                        │
│  ┌─────────┐      ┌─────────────────┐  │
│  │   LND   │ ←──→ │ Remote Signer   │  │
│  │ (watch) │      │ (HSM/HW Wallet) │  │
│  └─────────┘      └─────────────────┘  │
└─────────────────────────────────────────┘
```

**Reality check:** Full remote signing is tricky because:
- HTLCs require signing within seconds
- Hardware wallet latency may cause routing failures
- Some operations still need semi-hot keys

**Practical implementation:**
- Use VLS (Validating Lightning Signer) project
- Signer validates transactions before signing
- Can enforce policies (max payment size, rate limits)

**Pros:**
- Keys never on main server
- Policy enforcement at signing layer
- Production pattern used by River, Anchorage

**Cons:**
- Still need infrastructure for signer
- Latency-sensitive
- Complex operational setup

---

### Option D: Fedimint Integration (Distributed Custody)

**How it works:** Integrate with Fedimint federations. Users deposit BTC, receive ecash. Lightning through federation gateway.

```
User → Deposits BTC → Federation (3-of-5 guardians) → Ecash tokens
                                    ↓
                          Lightning Gateway → Pay/Receive
```

**Sanctuary's role:**
- Run a federation guardian (optional)
- Integrate as a client for user deposits/withdrawals
- Track balances and transaction history

**Pros:**
- No single point of custody
- Privacy benefits (ecash is bearer tokens)
- Scales well
- Growing ecosystem

**Cons:**
- Trust distributed, not eliminated
- Newer technology
- Requires federation coordination

---

### Option E: Full Lightning Node (Full Custody - With Safeguards)

**How it works:** Run LND/CLN with hot wallet, but implement defense-in-depth.

**Security architecture:**
```
┌─────────────────────────────────────────────────────────┐
│ Tiered Security Model                                   │
│                                                         │
│  COLD (Hardware Wallet - Existing)                      │
│  └── Long-term holdings, multisig, large txns          │
│                                                         │
│  WARM (Threshold Signer - 2-of-3)                       │
│  └── Channel opens/closes, liquidity rebalancing        │
│  └── Keys: HSM + Geographic distribution                │
│                                                         │
│  HOT (Rate-Limited)                                     │
│  └── Routing, small payments                            │
│  └── Daily limits enforced in code                      │
│  └── Alerts on anomalies                                │
└─────────────────────────────────────────────────────────┘
```

**Safeguards to implement:**
1. **Monetary limits** - Max channel size, daily outflow caps
2. **Velocity controls** - Unusual activity triggers review
3. **Geographic distribution** - Signer components in separate data centers
4. **Watchtower redundancy** - Multiple watchtowers for punishment
5. **Automatic channel backup** - Encrypted to user's hardware wallet pubkey

**Pros:**
- Full Lightning functionality
- Best UX (instant payments, receiving)
- Revenue opportunity (routing fees)

**Cons:**
- Hot wallet risk exists (mitigated, not eliminated)
- Operational complexity
- Regulatory implications

---

## Part 2: Taproot Assets Integration Options

### Option 1: View-Only Asset Tracking (Zero Custody)

**How it works:** Query Universe servers for asset metadata and balances. Display in Sanctuary UI. No issuance or transfers.

```typescript
// Integration with Universe API
interface TaprootAsset {
  assetId: string;
  name: string;
  balance: bigint;
  issuanceProof: string;
}

// Track assets tied to user's addresses
async function getAssetBalances(addresses: string[]): Promise<TaprootAsset[]> {
  return universeClient.queryAssets({ addresses });
}
```

**Pros:**
- Zero risk
- Simple integration
- Useful for tracking stablecoins, securities, etc.

**Cons:**
- No transfers
- Limited utility

---

### Option 2: Taproot Assets with Hardware Wallet Signing (Future)

**How it works:** When hardware wallets support Taproot Assets (they don't yet), transfers could be signed on device.

**Current status:**
- Taproot Assets launched on mainnet October 2023
- No hardware wallet support yet
- Likely 12-24 months out

**Preparation work:**
- Implement asset tracking (Option 1) now
- Design transfer flow assuming hardware signing
- Integrate when hardware support arrives

---

### Option 3: Taproot Assets over Lightning (Combined Integration)

**How it works:** Taproot Assets can be routed over Lightning channels. This combines Lightning and TA integration.

```
Alice (USD asset) → Lightning Channel → Bob (receives USD asset)
```

**Dependency:** Requires solving Lightning integration first.

**Pros:**
- Instant asset transfers
- Atomic swaps between BTC and assets

**Cons:**
- Requires Lightning custody solution
- Still experimental

---

## Part 3: Recommended Architecture - "Beacon" Lightning Service

### Why Separation Makes Sense

| Aspect | Sanctuary (Cold) | Lightning (Hot) |
|--------|------------------|-----------------|
| **Secrets** | Never holds keys | Must hold some keys |
| **Latency** | Seconds acceptable | Milliseconds required |
| **Uptime** | Graceful degradation OK | Must be always-on |
| **State** | Mostly stateless coordination | Highly stateful (channels) |
| **Recovery** | Hardware wallet is backup | Complex channel state backup |
| **Scaling** | Standard web app | Pathfinding, gossip, graph sync |

### Security Boundary

```
┌─────────────────────────────────────────────────────────────┐
│ SANCTUARY (Cold Domain)                                      │
│                                                              │
│  "I coordinate. I never hold secrets."                       │
│  - Hardware wallet interaction                               │
│  - Transaction construction                                  │
│  - Multisig coordination                                     │
│  - Watch-only wallets                                        │
│                                                              │
│  Attack surface: Can't steal funds even if fully compromised │
└─────────────────────────────────────────────────────────────┘
                              │
                    Integration API
                              │
┌─────────────────────────────────────────────────────────────┐
│ BEACON (Hot Domain)                                          │
│                                                              │
│  "I hold limited hot funds with strict controls."            │
│  - Channel management                                        │
│  - Invoice/payment handling                                  │
│  - Routing                                                   │
│  - Taproot Assets                                            │
│                                                              │
│  Attack surface: Limited to hot wallet caps                  │
└─────────────────────────────────────────────────────────────┘
```

### Deployment Flexibility

```
Option A: Sanctuary only (current users, no change)
┌─────────────┐
│  Sanctuary  │ ← Hardware wallet users happy as-is
└─────────────┘

Option B: Sanctuary + Self-hosted Lightning
┌─────────────┐     ┌─────────────────┐
│  Sanctuary  │◄───►│ Beacon          │ ← Power users run their own
└─────────────┘     │ (user-operated) │
                    └─────────────────┘

Option C: Sanctuary + Managed Lightning
┌─────────────┐     ┌─────────────────┐
│  Sanctuary  │◄───►│ Beacon          │ ← Hosted option for convenience
└─────────────┘     │ (you operate)   │
                    └─────────────────┘

Option D: Sanctuary + Third-party Lightning
┌─────────────┐     ┌─────────────────┐
│  Sanctuary  │◄───►│ Voltage/etc API │ ← Integrate existing providers
└─────────────┘     └─────────────────┘
```

---

## Part 4: Beacon Service Architecture

### Project Structure

```
sanctuary/                    # Existing repo (or monorepo root)
├── server/                   # Existing Sanctuary backend
├── gateway/                  # Existing mobile gateway
├── shared/                   # Shared types (expand for Lightning)
│   └── types/
│       └── lightning.ts      # Shared Lightning types
│
beacon/                       # New Lightning service (same repo or separate)
├── src/
│   ├── api/                  # REST/gRPC API
│   ├── lnd/                  # LND wrapper/client
│   ├── cln/                  # Core Lightning wrapper (optional)
│   ├── tapd/                 # Taproot Assets daemon wrapper
│   ├── channels/             # Channel management
│   ├── invoices/             # Invoice/payment handling
│   ├── routing/              # Pathfinding, fee optimization
│   ├── liquidity/            # LSP integration, rebalancing
│   ├── security/             # Rate limits, velocity controls
│   └── federation/           # Fedimint integration (optional)
├── prisma/                   # Separate DB schema
└── docker-compose.yml        # LND + tapd + beacon
```

### Integration API

```typescript
// beacon/src/api/types.ts
interface BeaconAPI {
  // Node info
  getInfo(): Promise<NodeInfo>;
  getBalance(): Promise<BalanceInfo>;

  // Invoices
  createInvoice(params: CreateInvoiceParams): Promise<Invoice>;
  payInvoice(params: PayInvoiceParams): Promise<Payment>;
  lookupInvoice(paymentHash: string): Promise<Invoice>;

  // Channels
  listChannels(): Promise<Channel[]>;
  openChannel(params: OpenChannelParams): Promise<ChannelPoint>;
  closeChannel(params: CloseChannelParams): Promise<ClosingTxid>;

  // Taproot Assets
  listAssets(): Promise<TaprootAsset[]>;
  sendAsset(params: SendAssetParams): Promise<AssetTransfer>;

  // Swaps (submarine swaps for cold → Lightning)
  createSwap(params: SwapParams): Promise<SubmarineSwap>;

  // Streaming
  subscribeInvoices(): AsyncIterable<Invoice>;
  subscribePayments(): AsyncIterable<Payment>;
  subscribeChannels(): AsyncIterable<ChannelUpdate>;
}
```

### Sanctuary Integration

```typescript
// server/src/services/lightning/beaconClient.ts
export class BeaconClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  // Called when user wants to pay Lightning from Sanctuary UI
  async payInvoice(invoice: string, userId: string): Promise<PaymentResult> {
    // 1. Validate user has Lightning enabled
    // 2. Check user's Lightning balance in Beacon
    // 3. Forward payment request to Beacon
    // 4. Record in Sanctuary transaction history
  }

  // Create invoice for receiving
  async createInvoice(
    amountSats: number,
    memo: string,
    userId: string
  ): Promise<Invoice> {
    // 1. Request invoice from Beacon
    // 2. Associate with Sanctuary user
    // 3. Return invoice for display
  }

  // Submarine swap: pay Lightning from cold storage
  async payFromCold(
    invoice: string,
    walletId: string,
  ): Promise<SwapTransaction> {
    // 1. Create submarine swap in Beacon
    // 2. Return on-chain address for user to sign with hardware wallet
    // 3. Monitor swap completion
  }
}
```

### Security Controls

```typescript
// beacon/src/security/limits.ts

interface UserLimits {
  maxBalanceSats: number;        // Cap on Lightning balance
  maxPaymentSats: number;        // Single payment limit
  dailyOutflowSats: number;      // 24h outflow limit
  requireApprovalAbove: number;  // Human approval threshold
}

const DEFAULT_LIMITS: UserLimits = {
  maxBalanceSats: 10_000_000,      // 0.1 BTC
  maxPaymentSats: 1_000_000,       // 0.01 BTC
  dailyOutflowSats: 5_000_000,     // 0.05 BTC
  requireApprovalAbove: 500_000,   // 0.005 BTC
};

// Enforced at payment time
async function validatePayment(
  userId: string,
  amountSats: number
): Promise<ValidationResult> {
  const limits = await getUserLimits(userId);
  const dailyOutflow = await getDailyOutflow(userId);

  if (amountSats > limits.maxPaymentSats) {
    return { allowed: false, reason: 'Exceeds single payment limit' };
  }

  if (dailyOutflow + amountSats > limits.dailyOutflowSats) {
    return { allowed: false, reason: 'Exceeds daily limit' };
  }

  if (amountSats > limits.requireApprovalAbove) {
    return { allowed: false, reason: 'Requires approval', needsApproval: true };
  }

  return { allowed: true };
}
```

### Database Schema (Separate from Sanctuary)

```prisma
// beacon/prisma/schema.prisma

model LightningUser {
  id              String   @id @default(uuid())
  sanctuaryUserId String   @unique  // Foreign reference, not FK
  createdAt       DateTime @default(now())

  channels        Channel[]
  invoices        Invoice[]
  payments        Payment[]
  balanceLimit    BigInt   @default(1000000) // 1M sats default limit
}

model Channel {
  id              String   @id
  remotePubkey    String
  capacity        BigInt
  localBalance    BigInt
  remoteBalance   BigInt
  status          ChannelStatus
  userId          String
  user            LightningUser @relation(...)
}

model Invoice {
  paymentHash     String   @id
  paymentRequest  String
  amountMsat      BigInt
  memo            String?
  status          InvoiceStatus
  settledAt       DateTime?
  userId          String
  user            LightningUser @relation(...)
}
```

---

## Part 5: Phased Implementation Plan

### Phase 1: Beacon MVP (Submarine Swaps Only)

**No hot wallet yet** - just wrap swap functionality:

```
beacon/
├── src/
│   ├── api/
│   │   └── swaps.ts          # Submarine swap endpoints
│   ├── boltz/
│   │   └── client.ts         # Boltz API integration
│   └── index.ts
```

- Pay Lightning invoices from cold storage
- No channel management
- No receiving (yet)
- Minimal attack surface

**Risk Level:** Zero custody

### Phase 2: Fedimint Integration

Add distributed custody option:

```
beacon/
├── src/
│   ├── federation/
│   │   ├── client.ts         # Fedimint client
│   │   ├── gateway.ts        # Lightning gateway interaction
│   │   └── ecash.ts          # Token management
```

- Users can deposit to federation
- Lightning via federation gateway
- Distributed trust model

**Risk Level:** Distributed custody

### Phase 3: Native Lightning (Optional)

Full LND integration with security controls:

```
beacon/
├── src/
│   ├── lnd/
│   │   ├── client.ts         # LND gRPC client
│   │   ├── macaroons.ts      # Auth management
│   │   └── signer.ts         # Remote signer integration
│   ├── channels/
│   ├── liquidity/
│   └── security/
│       ├── limits.ts
│       ├── velocity.ts
│       └── alerts.ts
```

**Risk Level:** Controlled hot wallet

### Phase 4: Taproot Assets

Add tapd integration:

```
beacon/
├── src/
│   ├── tapd/
│   │   ├── client.ts         # tapd gRPC client
│   │   ├── assets.ts         # Asset management
│   │   ├── universe.ts       # Universe sync
│   │   └── transfers.ts      # Asset transfers
```

---

## Part 6: UI Integration Mockup

Users see one unified app, not two:

```
┌─────────────────────────────────────────────────────────────┐
│  Sanctuary                                        [Settings] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Total Balance                                               │
│  ₿ 2.45678901                                               │
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │ ⛓️  On-Chain         │  │ ⚡ Lightning         │           │
│  │                     │  │                     │           │
│  │ ₿ 2.35678901       │  │ ₿ 0.10000000       │           │
│  │ Cold Storage        │  │ Hot (Beacon)        │           │
│  │                     │  │                     │           │
│  │ [Send] [Receive]    │  │ [Send] [Receive]    │           │
│  └─────────────────────┘  └─────────────────────┘           │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 🎨 Taproot Assets                                        ││
│  │                                                          ││
│  │ USDT     $1,000.00     │  OCEAN   500 shares            ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Recent Activity                                             │
│  ─────────────────────────────────────────────────          │
│  ⚡ Received  +50,000 sats   2 min ago                       │
│  ⛓️  Sent     -0.05 BTC      1 hour ago   [2 confirmations]  │
│  ⚡ Paid      -10,000 sats   3 hours ago                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Flow: Pay Lightning from Cold Storage

```
User clicks "Pay" on Lightning invoice that exceeds Lightning balance

┌─────────────────────────────────────────────┐
│ Pay Invoice                                  │
│                                              │
│ Amount: 500,000 sats                         │
│                                              │
│ ⚡ Lightning Balance: 100,000 sats           │
│ ⛓️  Cold Storage: 2.35 BTC                   │
│                                              │
│ ┌─────────────────────────────────────────┐ │
│ │ ⚠️  Insufficient Lightning balance        │ │
│ │                                          │ │
│ │ Options:                                 │ │
│ │ ○ Top up Lightning (move from cold)     │ │
│ │ ● Pay via submarine swap (one-time)     │ │
│ │                                          │ │
│ │ Swap fee: ~1,500 sats (0.3%)            │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ [Cancel]                    [Continue →]    │
└─────────────────────────────────────────────┘

→ Creates submarine swap
→ User signs on-chain tx with hardware wallet
→ Beacon completes Lightning payment atomically
```

---

## Decision Framework

Questions to guide implementation choices:

1. **What's the use case?**
   - Payments to merchants → Submarine swaps work fine
   - Receiving tips/payments → Need LSP or federation
   - High-frequency trading → Need full Lightning

2. **What's the expected volume?**
   - Low volume → Submarine swaps (fees acceptable)
   - High volume → Need channels (amortize fees)

3. **Is this B2C or B2B?**
   - B2C → Users expect "it just works"
   - B2B → Enterprises may run their own nodes

4. **Regulatory exposure?**
   - Custodial Lightning = money transmission in many jurisdictions
   - Non-custodial avoids this entirely

---

## Summary

| Approach | Custody Level | Complexity | Best For |
|----------|---------------|------------|----------|
| Submarine Swaps | None | Low | Outbound payments only |
| LSP Integration | Minimal | Medium | Quick market entry |
| Remote Signing | Partial | High | Enterprise security |
| Fedimint | Distributed | Medium | Privacy + trust distribution |
| Full Lightning | Full (controlled) | High | Maximum functionality |

**Recommended path:** Start with Phase 1 (submarine swaps) to validate integration patterns with zero custody risk, then expand based on user demand.
