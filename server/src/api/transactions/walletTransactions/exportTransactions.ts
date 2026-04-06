/**
 * Wallet Transactions - Export Route
 *
 * Endpoint for exporting wallet transactions in CSV or JSON format.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { db as prisma } from '../../../repositories/db';
import { asyncHandler } from '../../../errors/errorHandler';

/**
 * Create the export transactions router
 */
export function createExportRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/wallets/:walletId/transactions/export
   * Export transactions for a wallet in CSV or JSON format
   */
  router.get('/wallets/:walletId/transactions/export', requireWalletAccess('view'), asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    const { format = 'csv', startDate, endDate } = req.query;

    // Build date filter
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate as string);
    }
    if (endDate) {
      // Set to end of day
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    // Get wallet name for filename
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { name: true },
    });

    // Query all transactions (no pagination for export)
    const transactions = await prisma.transaction.findMany({
      where: {
        walletId,
        ...(Object.keys(dateFilter).length > 0 ? { blockTime: dateFilter } : {}),
      },
      include: {
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { blockTime: 'asc' },  // Oldest first to match Sparrow format
    });

    // Convert to export format
    // The amount in DB is already correctly signed:
    // - sent: negative (includes fee)
    // - consolidation: negative (just the fee)
    // - received: positive
    const exportData = transactions.map(tx => {
      // Use the stored amount directly - it's already correctly signed
      const signedAmount = Number(tx.amount);

      return {
        date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
        txid: tx.txid,
        type: tx.type,
        amountBtc: signedAmount / 100000000,
        amountSats: signedAmount,
        balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100000000 : null,
        balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
        feeSats: tx.fee ? Number(tx.fee) : null,
        confirmations: tx.confirmations,
        label: tx.label || '',
        memo: tx.memo || '',
        counterpartyAddress: tx.counterpartyAddress || '',
        blockHeight: tx.blockHeight ? Number(tx.blockHeight) : null,
      };
    });

    const walletName = wallet?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'wallet';
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${walletName}_transactions_${timestamp}.json"`);
      return res.json(exportData);
    }

    // Generate CSV
    const csvHeaders = [
      'Date',
      'Transaction ID',
      'Type',
      'Amount (BTC)',
      'Amount (sats)',
      'Balance After (BTC)',
      'Balance After (sats)',
      'Fee (sats)',
      'Confirmations',
      'Label',
      'Memo',
      'Counterparty Address',
      'Block Height',
    ];

    const escapeCSV = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = exportData.map(tx => [
      escapeCSV(tx.date),
      escapeCSV(tx.txid),
      escapeCSV(tx.type),
      escapeCSV(tx.amountBtc),
      escapeCSV(tx.amountSats),
      escapeCSV(tx.balanceAfterBtc),
      escapeCSV(tx.balanceAfterSats),
      escapeCSV(tx.feeSats),
      escapeCSV(tx.confirmations),
      escapeCSV(tx.label),
      escapeCSV(tx.memo),
      escapeCSV(tx.counterpartyAddress),
      escapeCSV(tx.blockHeight),
    ].join(','));

    const csv = [csvHeaders.join(','), ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${walletName}_transactions_${timestamp}.csv"`);
    res.send(csv);
  }));

  return router;
}
