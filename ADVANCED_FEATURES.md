# Advanced Bitcoin Transaction Features

This document describes the advanced Bitcoin transaction features that have been implemented in Sanctuary.

## Features Implemented

### 1. RBF (Replace-By-Fee)

Replace-By-Fee allows you to speed up stuck transactions by creating a replacement transaction with a higher fee.

#### Backend Implementation
- **File**: `server/src/services/bitcoin/advancedTx.ts`
- **Functions**:
  - `isRBFSignaled(txHex)` - Check if transaction signals RBF
  - `canReplaceTransaction(txid)` - Verify if transaction is replaceable
  - `createRBFTransaction(txid, newFeeRate, walletId)` - Create replacement transaction

#### API Endpoints
- `POST /api/v1/bitcoin/transaction/:txid/rbf-check` - Check RBF status
- `POST /api/v1/bitcoin/transaction/:txid/rbf` - Create RBF transaction

#### Frontend Component
- **File**: `components/TransactionActions.tsx`
- Shows RBF button on unconfirmed outgoing transactions
- Displays current fee rate and minimum new fee rate
- Creates replacement transaction with higher fee

#### How It Works
1. Transaction must be unconfirmed and signal RBF (sequence < 0xfffffffe)
2. New fee rate must be higher than current by at least 1 sat/vB
3. Fee increase is deducted from change output
4. Original transaction is replaced in mempool

### 2. CPFP (Child-Pays-For-Parent)

Child-Pays-For-Parent allows you to speed up transactions by spending from them with a higher fee.

#### Backend Implementation
- **File**: `server/src/services/bitcoin/advancedTx.ts`
- **Functions**:
  - `calculateCPFPFee(parentTxSize, parentFeeRate, childTxSize, targetFeeRate)` - Calculate required child fee
  - `createCPFPTransaction(parentTxid, parentVout, targetFeeRate, recipientAddress, walletId)` - Create child transaction

#### API Endpoints
- `POST /api/v1/bitcoin/transaction/cpfp` - Create CPFP transaction

#### Frontend Component
- **File**: `components/TransactionActions.tsx`
- Shows CPFP button on unconfirmed incoming transactions
- Calculates effective fee rate for parent + child package
- Creates child transaction spending from parent

#### How It Works
1. Creates a new transaction spending an output from the stuck transaction
2. Child transaction pays a higher fee to incentivize mining both transactions
3. Effective fee rate is calculated for the package (parent + child)
4. Miners are incentivized to mine both to get the child's higher fee

### 3. Batch Transactions

Send to multiple recipients in a single transaction, saving significant fees.

#### Backend Implementation
- **File**: `server/src/services/bitcoin/advancedTx.ts`
- **Functions**:
  - `createBatchTransaction(recipients, feeRate, walletId, selectedUtxoIds)` - Create batch transaction
  - Automatically selects UTXOs
  - Calculates fee savings vs individual transactions

#### API Endpoints
- `POST /api/v1/bitcoin/transaction/batch` - Create batch transaction

#### Frontend Component
- **File**: `components/BatchSend.tsx`
- Full UI for batch sending
- Add/remove multiple recipients
- Shows fee comparison and savings
- Displays total cost breakdown

#### How It Works
1. Multiple outputs are combined into a single transaction
2. Significant fee savings (typically 60%+) compared to individual transactions
3. All payments are confirmed together in one block
4. Includes automatic UTXO selection and change output handling

### 4. Advanced Fee Estimation

More granular fee estimation with time predictions.

#### Backend Implementation
- **File**: `server/src/services/bitcoin/advancedTx.ts`
- **Functions**:
  - `getAdvancedFeeEstimates()` - Get fee estimates for 5 priority levels
  - `estimateOptimalFee(inputCount, outputCount, priority, scriptType)` - Calculate optimal fee

#### API Endpoints
- `GET /api/v1/bitcoin/fees/advanced` - Get advanced fee estimates
- `POST /api/v1/bitcoin/utils/estimate-optimal-fee` - Get optimal fee for transaction

#### Fee Levels
- **Fastest**: ~10 minutes (1 block)
- **Fast**: ~30 minutes (3 blocks)
- **Medium**: ~60 minutes (6 blocks)
- **Slow**: ~120 minutes (12 blocks)
- **Minimum**: ~24 hours (144 blocks)

### 5. RBF Enabled by Default

All transactions now signal RBF by default for maximum flexibility.

#### Implementation
- **File**: `server/src/services/bitcoin/utils.ts`
- Updated `createTransaction()` to use RBF sequence (0xfffffffd) by default
- Can be disabled with `enableRBF: false` option

## Usage Examples

### Check if Transaction Can Use RBF
```typescript
import * as bitcoinApi from '../src/api/bitcoin';

const result = await bitcoinApi.checkRBF(txid);
if (result.replaceable) {
  console.log(`Current fee: ${result.currentFeeRate} sat/vB`);
  console.log(`Minimum new fee: ${result.minNewFeeRate} sat/vB`);
}
```

### Create RBF Transaction
```typescript
const rbfTx = await bitcoinApi.createRBFTransaction(txid, {
  newFeeRate: 50, // sat/vB
  walletId: 'wallet-id'
});

console.log(`Fee increased by ${rbfTx.feeDelta} sats`);
```

### Create CPFP Transaction
```typescript
const cpfpTx = await bitcoinApi.createCPFPTransaction({
  parentTxid: 'parent-tx-id',
  parentVout: 0,
  targetFeeRate: 50, // sat/vB
  recipientAddress: 'bc1q...',
  walletId: 'wallet-id'
});

console.log(`Effective fee rate: ${cpfpTx.effectiveFeeRate} sat/vB`);
```

### Create Batch Transaction
```typescript
const batchTx = await bitcoinApi.createBatchTransaction({
  recipients: [
    { address: 'bc1q...', amount: 10000 },
    { address: 'bc1q...', amount: 20000 },
    { address: 'bc1q...', amount: 30000 }
  ],
  feeRate: 10,
  walletId: 'wallet-id'
});

console.log(`Saved ${batchTx.savedFees} sats vs individual transactions`);
```

### Get Advanced Fee Estimates
```typescript
const fees = await bitcoinApi.getAdvancedFeeEstimates();

console.log(`Fastest: ${fees.fastest.feeRate} sat/vB (~${fees.fastest.minutes} min)`);
console.log(`Medium: ${fees.medium.feeRate} sat/vB (~${fees.medium.minutes} min)`);
```

## Technical Details

### RBF Sequence Numbers
- **0xfffffffd**: Signals RBF, allows replacement
- **0xfffffffe**: Maximum RBF sequence
- **0xffffffff**: Final, no replacement allowed

### Fee Calculation
- Uses virtual bytes (vBytes) for SegWit transactions
- Accurate size estimation for different script types
- Minimum fee bump of 1 sat/vB for RBF

### UTXO Selection
- Largest-first selection for batch transactions
- Automatic change output creation
- Configurable dust threshold (default: 546 sats, see Admin → Variables)

### Safety Features
- Validates all addresses before creating transactions
- Checks sufficient balance including fees
- Prevents creating dust outputs
- Verifies RBF eligibility before replacement
- Calculates accurate fee requirements

## Integration Points

### Transaction List
- Add `TransactionActions` component to transaction details
- Shows RBF/CPFP buttons based on transaction status

### Send Flow
- Enhanced fee selection with time estimates
- RBF enabled by default on all transactions
- Link to batch send for multiple recipients

### Wallet Routes
- Add `/wallets/:id/batch-send` route for `BatchSend` component

## Future Enhancements

Potential improvements for future versions:

1. **Manual UTXO Selection for RBF**: Allow users to add/remove inputs when bumping fees
2. **CPFP Multiple Outputs**: Support spending multiple outputs in one child transaction
3. **Batch Import**: CSV import for batch sending
4. **Fee Bumping Recommendations**: Suggest optimal fee bumps based on mempool
5. **Replace Chain**: Handle replacing already-replaced transactions
6. **Full RBF Support**: Optional full-RBF signaling
7. **Package Relay**: Take advantage of package relay when available

## Security Considerations

1. **RBF Conflicts**: Original transaction may still confirm before replacement
2. **Double Spend Risk**: Merchants should wait for confirmations on RBF transactions
3. **Fee Bumping Limits**: Change output must be large enough to cover fee increases
4. **CPFP Economics**: Child transaction must have sufficient value to pay for both transactions

## Testing Recommendations

1. Test RBF with various fee increases
2. Verify CPFP calculation accuracy
3. Test batch transactions with multiple recipients
4. Confirm fee estimation matches actual network conditions
5. Test edge cases (minimum fees, maximum recipients, etc.)
6. Verify hardware wallet signing for all transaction types
