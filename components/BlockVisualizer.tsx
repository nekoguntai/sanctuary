import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ArrowRight, Clock, Boxes, ExternalLink } from 'lucide-react';
import type { PendingTransaction } from '../src/types';

export interface BlockData {
  height: number | string;
  medianFee: number;
  feeRange: string;
  size: number; // in MB (approx)
  time: string;
  status: 'pending' | 'confirmed';
  txCount?: number; // Transaction count
  totalFees?: number; // Total fees in BTC
  hash?: string; // Block hash for confirmed blocks
}

export interface QueuedBlocksSummary {
  blockCount: number;
  totalTransactions: number;
  averageFee: number;
  totalFees: number;
}

interface BlockVisualizerProps {
  blocks?: BlockData[];
  queuedBlocksSummary?: QueuedBlocksSummary | null;
  pendingTxs?: PendingTransaction[]; // User's pending transactions
  onBlockClick?: (feeRate: number) => void;
  compact?: boolean;
  explorerUrl?: string;
  onRefresh?: () => void; // Called when data should be refreshed (e.g., new block)
}

// Get color based on block status (sanctuary theme)
// Note: In dark mode, warning/success values are inverted in the theme
// So we use specific shades that work correctly in both modes
const getBlockColors = (isPending: boolean) => {
  if (isPending) {
    // Pending blocks use warning/amber colors
    // Light: warning-200 (#efe0c0), Dark: warning-200 is actually dark (#644a2d)
    return {
      bg: 'bg-warning-200 dark:bg-warning-200',
      bar: 'bg-warning-600 dark:bg-warning-600',
      barBg: 'bg-warning-100 dark:bg-warning-100',
      text: 'text-warning-800 dark:text-warning-800',
      label: 'bg-warning-500 text-white dark:bg-warning-500 dark:text-white'
    };
  } else {
    // Confirmed blocks use success/green colors
    return {
      bg: 'bg-success-200 dark:bg-success-200',
      bar: 'bg-success-600 dark:bg-success-600',
      barBg: 'bg-success-100 dark:bg-success-100',
      text: 'text-success-800 dark:text-success-800',
      label: 'bg-success-500 text-white dark:bg-success-500 dark:text-white'
    };
  }
};

// Block component with solid colors and horizontal fill bar
const Block: React.FC<{
  block: BlockData;
  index: number;
  onClick: () => void;
  compact: boolean;
  isAnimating: boolean;
  animationDirection: 'enter' | 'exit' | 'none';
  pendingTxs?: PendingTransaction[];
  explorerUrl: string;
}> = ({ block, index, onClick, compact, isAnimating, animationDirection, pendingTxs = [], explorerUrl }) => {
  const isPending = block.status === 'pending';
  const colors = getBlockColors(isPending);

  // Calculate fill percentage (how full the block is)
  // Max block size is ~4MB (weight), typical is 1.5-2MB
  const fillPercentage = Math.min((block.size / 1.6) * 100, 100);

  // Animation classes
  const getAnimationClass = () => {
    if (!isAnimating) return '';
    if (animationDirection === 'enter') return 'animate-block-enter';
    if (animationDirection === 'exit') return 'animate-block-exit';
    return '';
  };

  return (
    <div className="relative group flex flex-col items-center">
      <button
        onClick={onClick}
        className={`
          relative flex-shrink-0 flex flex-col
          ${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32 md:w-32 md:h-36'}
          rounded-lg overflow-hidden transition-all duration-300
          hover:scale-105 hover:shadow-lg hover:z-20
          cursor-pointer
          ${colors.bg}
          ${getAnimationClass()}
        `}
        style={{
          animationDelay: `${index * 50}ms`,
        }}
      >
        {/* Pending transaction dots - top right corner */}
        {pendingTxs.length > 0 && (
          <div className={`
            absolute z-20
            ${compact ? 'top-0.5 right-0.5' : 'top-1 right-1'}
            flex flex-wrap gap-0.5 max-w-[50%] justify-end
          `}>
            {pendingTxs.slice(0, compact ? 3 : 5).map((tx) => (
              <PendingTxDot
                key={tx.txid}
                tx={tx}
                explorerUrl={explorerUrl}
                compact={compact}
              />
            ))}
            {pendingTxs.length > (compact ? 3 : 5) && (
              <span className={`
                ${compact ? 'text-[8px]' : 'text-[9px]'}
                font-bold text-sanctuary-700 dark:text-sanctuary-300
              `}>
                +{pendingTxs.length - (compact ? 3 : 5)}
              </span>
            )}
          </div>
        )}

        {/* Content */}
        <div className={`relative z-10 flex flex-col items-center justify-between h-full ${compact ? 'py-1.5 px-1' : 'py-2 px-1'}`}>
          {/* Top: Time - hidden in compact mode */}
          {!compact && (
            <div className={`flex items-center text-[10px] font-bold ${colors.text}`}>
              <Clock className="w-3 h-3 mr-1" />
              <span className="truncate max-w-[60px]">{block.time}</span>
            </div>
          )}

          {/* Middle: Median Fee - main focus */}
          <div className="text-center">
            {!compact && <div className={`text-[10px] uppercase font-bold ${colors.text} mb-0.5`}>Median</div>}
            <div className={`${compact ? 'text-base' : 'text-xl md:text-2xl'} font-black leading-none ${colors.text}`}>
              {Math.round(block.medianFee)}
            </div>
            <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold ${colors.text}`}>sat/vB</div>
          </div>

          {/* Bottom: Height label - darker background */}
          <div className="w-full text-center">
            <div className={`${compact ? 'text-[9px] py-0.5 mx-0.5' : 'text-[10px] py-0.5 mx-1'} font-mono font-bold rounded ${colors.label}`}>
              {isPending ? `${compact ? '' : 'BLK '}${block.height}` : `#${typeof block.height === 'number' ? (compact ? block.height : block.height.toLocaleString()) : block.height}`}
            </div>
          </div>
        </div>

        {/* Horizontal fullness bar at bottom */}
        <div className={`absolute bottom-0 left-0 right-0 h-1.5 ${colors.barBg}`}>
          <div
            className={`h-full ${colors.bar} transition-all duration-500 rounded-r-sm`}
            style={{ width: `${fillPercentage}%` }}
          />
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:group-hover:bg-white/5 transition-colors duration-200 rounded-lg" />
      </button>

      {/* Time label below block in compact mode */}
      {compact && (
        <div className={`text-[10px] font-medium mt-1 ${isPending ? 'text-warning-600 dark:text-warning-400' : 'text-sanctuary-400 dark:text-sanctuary-500'}`}>
          {block.time}
        </div>
      )}

      {/* TX count tooltip on hover - outside button to avoid overflow clip */}
      {!compact && block.txCount !== undefined && (
        <div className={`
          absolute top-full left-1/2 -translate-x-1/2 mt-1
          text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded
          bg-sanctuary-800 text-white dark:bg-white dark:text-sanctuary-900
          opacity-0 group-hover:opacity-100 transition-opacity duration-200
          whitespace-nowrap z-50 pointer-events-none shadow-lg
        `}>
          {block.txCount.toLocaleString()} txs • {Math.round(fillPercentage)}% full
        </div>
      )}
    </div>
  );
};

// Summary block for queued transactions - darker than regular pending blocks
const QueuedSummaryBlock: React.FC<{
  summary: QueuedBlocksSummary;
  compact: boolean;
}> = ({ summary, compact }) => {
  // Generate mini block indicators for the bottom bar
  const maxVisibleBlocks = 8;
  const visibleBlocks = Math.min(summary.blockCount, maxVisibleBlocks);
  const hasMore = summary.blockCount > maxVisibleBlocks;

  return (
    <div className="relative group flex flex-col items-center">
      <div
        className={`
          relative flex-shrink-0 flex flex-col
          ${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32 md:w-32 md:h-36'}
          rounded-lg overflow-hidden
          bg-warning-500 dark:bg-warning-100
        `}
      >
        {/* Content */}
        <div className={`relative z-10 flex flex-col items-center justify-between h-full ${compact ? 'py-1.5 px-1' : 'py-2 px-1'}`}>
          {/* Top spacer - hidden in compact */}
          {!compact && <div className="text-[10px] font-bold text-white dark:text-warning-900">Queue</div>}

          {/* Middle: Average Fee */}
          <div className="text-center">
            {!compact && <div className="text-[10px] uppercase font-bold text-white dark:text-warning-900 mb-0.5">Avg Fee</div>}
            <div className={`${compact ? 'text-base' : 'text-xl'} font-black leading-none text-white dark:text-warning-900`}>
              {Math.round(summary.averageFee)}
            </div>
            <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold text-white dark:text-warning-900`}>sat/vB</div>
          </div>

          {/* Bottom: Block count - darker background */}
          <div className="w-full text-center">
            <div className={`${compact ? 'text-[9px] py-0.5 mx-0.5' : 'text-[10px] py-0.5 mx-1'} font-mono font-bold rounded bg-warning-700 text-white dark:bg-warning-50 dark:text-warning-900`}>
              +{summary.blockCount}{compact ? '' : ' BLKS'}
            </div>
          </div>
        </div>

        {/* Bottom bar: stacked mini blocks instead of fullness indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-warning-600 dark:bg-warning-50 flex items-center justify-center gap-[2px] px-1">
          {[...Array(visibleBlocks)].map((_, i) => (
            <div
              key={i}
              className="h-1.5 flex-1 max-w-[10px] rounded-[1px] bg-warning-800 dark:bg-warning-500"
            />
          ))}
          {hasMore && (
            <div className="text-[6px] font-bold text-white dark:text-warning-700 ml-0.5">+</div>
          )}
        </div>
      </div>

      {/* "Queued" label below block in compact mode */}
      {compact && (
        <div className="text-[10px] font-medium mt-1 text-warning-600 dark:text-warning-400">
          Queued
        </div>
      )}

      {/* TX count tooltip on hover */}
      {!compact && (
        <div className={`
          absolute top-full left-1/2 -translate-x-1/2 mt-1
          text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded
          bg-sanctuary-800 text-white dark:bg-white dark:text-sanctuary-900
          opacity-0 group-hover:opacity-100 transition-opacity duration-200
          whitespace-nowrap z-50 pointer-events-none shadow-lg
        `}>
          {summary.totalTransactions.toLocaleString()} txs waiting
        </div>
      )}
    </div>
  );
};

// Format seconds into human readable time
const formatTimeInQueue = (seconds: number): string => {
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

// Pending transaction dot component
const PendingTxDot: React.FC<{
  tx: PendingTransaction;
  explorerUrl: string;
  compact: boolean;
}> = ({ tx, explorerUrl, compact }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const isSent = tx.type === 'sent';

  // Colors: rose for sent, muted red/coral for received
  const dotColor = isSent
    ? 'bg-rose-500 dark:bg-rose-400'
    : 'bg-red-400/80 dark:bg-red-400/70';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`${explorerUrl}/tx/${tx.txid}`, '_blank');
  };

  // Calculate ETA based on position in mempool (rough estimate)
  const estimateEta = (): string => {
    if (tx.feeRate >= 20) return '~10 min';
    if (tx.feeRate >= 10) return '~30 min';
    if (tx.feeRate >= 5) return '~1 hour';
    return '~2+ hours';
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={handleClick}
        className={`
          ${compact ? 'w-2 h-2' : 'w-2.5 h-2.5'}
          rounded-full ${dotColor}
          hover:scale-125 transition-transform duration-150
          ring-1 ring-white/50 dark:ring-black/30
          cursor-pointer
        `}
        title={`${isSent ? 'Sending' : 'Receiving'} ${tx.feeRate} sat/vB`}
      />

      {/* Detailed tooltip */}
      {showTooltip && !compact && (
        <div className={`
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          bg-sanctuary-900 dark:bg-sanctuary-100
          text-white dark:text-sanctuary-900
          text-[10px] rounded-lg shadow-lg
          py-2 px-3 z-[100]
          whitespace-nowrap
          pointer-events-none
        `}>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="border-4 border-transparent border-t-sanctuary-900 dark:border-t-sanctuary-100" />
          </div>

          {/* Content */}
          <div className="space-y-1">
            <div className="font-bold text-[11px] flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              {isSent ? 'Sending' : 'Receiving'}
            </div>

            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
              <span className="text-sanctuary-400 dark:text-sanctuary-500">Fee Rate:</span>
              <span className="font-mono font-bold">{tx.feeRate.toFixed(1)} sat/vB</span>

              <span className="text-sanctuary-400 dark:text-sanctuary-500">ETA:</span>
              <span className="font-bold">{estimateEta()}</span>

              <span className="text-sanctuary-400 dark:text-sanctuary-500">Fee:</span>
              <span className="font-mono">{tx.fee.toLocaleString()} sats</span>

              <span className="text-sanctuary-400 dark:text-sanctuary-500">Amount:</span>
              <span className="font-mono">{Math.abs(tx.amount).toLocaleString()} sats</span>

              {tx.recipient && (
                <>
                  <span className="text-sanctuary-400 dark:text-sanctuary-500">To:</span>
                  <span className="font-mono truncate max-w-[120px]">
                    {tx.recipient.slice(0, 8)}...{tx.recipient.slice(-4)}
                  </span>
                </>
              )}

              <span className="text-sanctuary-400 dark:text-sanctuary-500">Waiting:</span>
              <span>{formatTimeInQueue(tx.timeInQueue)}</span>
            </div>

            <div className="text-sanctuary-500 dark:text-sanctuary-400 text-[9px] pt-1 border-t border-sanctuary-700 dark:border-sanctuary-300 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              Click to view in explorer
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Parse fee range string "min-max" into [min, max] numbers
const parseFeeRange = (feeRange: string): [number, number] => {
  const parts = feeRange.split('-').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return [parts[0], parts[1]];
  }
  return [0, Infinity]; // Fallback
};

// Helper to match pending transactions to blocks based on fee rate
// Uses actual fee ranges from mempool data for accurate predictions
const getTxsForBlock = (
  block: BlockData,
  allPendingTxs: PendingTransaction[],
  blockIndex: number,
  totalPendingBlocks: number,
  allBlocks: BlockData[]
): PendingTransaction[] => {
  // Only show in pending blocks
  if (block.status !== 'pending') return [];

  const [minFee, maxFee] = parseFeeRange(block.feeRange);

  // Get the next block's min fee (if exists) to set upper bound
  const nextBlock = blockIndex > 0 ? allBlocks[blockIndex - 1] : null;
  const nextBlockMinFee = nextBlock ? parseFeeRange(nextBlock.feeRange)[0] : Infinity;

  return allPendingTxs.filter(tx => {
    // First block (Next): tx fee rate >= this block's min fee
    if (blockIndex === 0) {
      return tx.feeRate >= minFee;
    }

    // Last pending block: anything below this block's max fee that didn't fit in earlier blocks
    if (blockIndex === totalPendingBlocks - 1) {
      return tx.feeRate < nextBlockMinFee && tx.feeRate >= Math.max(minFee * 0.5, 1);
    }

    // Middle blocks: fee rate between this block's range and next block's min
    return tx.feeRate >= minFee && tx.feeRate < nextBlockMinFee;
  });
};

export const BlockVisualizer: React.FC<BlockVisualizerProps> = ({
  blocks,
  queuedBlocksSummary,
  pendingTxs = [],
  onBlockClick,
  compact = false,
  explorerUrl = 'https://mempool.space',
  onRefresh
}) => {
  const [displayBlocks, setDisplayBlocks] = useState<BlockData[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [newBlockDetected, setNewBlockDetected] = useState(false);
  const prevBlocksRef = useRef<BlockData[]>([]);

  // Detect new blocks and trigger animation
  useEffect(() => {
    if (!blocks || blocks.length === 0) {
      setDisplayBlocks([]);
      return;
    }

    const prevBlocks = prevBlocksRef.current;
    const newBlocks = blocks;

    // Check if we have a new confirmed block (first confirmed block height changed)
    const prevConfirmed = prevBlocks.filter(b => b.status === 'confirmed');
    const newConfirmed = newBlocks.filter(b => b.status === 'confirmed');

    if (prevConfirmed.length > 0 && newConfirmed.length > 0) {
      const prevFirstHeight = prevConfirmed[0]?.height;
      const newFirstHeight = newConfirmed[0]?.height;

      if (prevFirstHeight !== newFirstHeight && typeof newFirstHeight === 'number') {
        // New block detected! Trigger animation
        setNewBlockDetected(true);
        setIsAnimating(true);

        // After animation completes, update display
        setTimeout(() => {
          setDisplayBlocks(newBlocks);
          setIsAnimating(false);
          setNewBlockDetected(false);
        }, 600);

        prevBlocksRef.current = newBlocks;
        return;
      }
    }

    // No new block, just update
    setDisplayBlocks(newBlocks);
    prevBlocksRef.current = newBlocks;
  }, [blocks]);

  const handleBlockClick = useCallback((block: BlockData, pendingIndex?: number) => {
    // Open in explorer
    if (block.status === 'confirmed' && typeof block.height === 'number') {
      window.open(`${explorerUrl}/block/${block.height}`, '_blank');
    } else if (block.status === 'pending' && pendingIndex !== undefined) {
      // For pending blocks, link to mempool-block view (mempool.space compatible)
      window.open(`${explorerUrl}/mempool-block/${pendingIndex}`, '_blank');
    }
    // Call callback for fee selection
    if (onBlockClick) {
      onBlockClick(block.medianFee);
    }
  }, [explorerUrl, onBlockClick]);

  // Separate pending and confirmed blocks
  const pendingBlocks = displayBlocks.filter(b => b.status === 'pending');
  const confirmedBlocks = displayBlocks.filter(b => b.status === 'confirmed');

  return (
    <div className="w-full overflow-hidden">
      {/* CSS for animations */}
      <style>{`
        @keyframes blockEnter {
          0% {
            transform: translateX(-100%) scale(0.8);
            opacity: 0;
          }
          100% {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
        }

        @keyframes blockExit {
          0% {
            transform: translateX(0);
            opacity: 1;
          }
          100% {
            transform: translateX(100%);
            opacity: 0;
          }
        }

        @keyframes blockSlide {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(calc(100% + 12px));
          }
        }

        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4);
          }
          50% {
            box-shadow: 0 0 20px 10px rgba(251, 191, 36, 0.2);
          }
        }

        .animate-block-enter {
          animation: blockEnter 0.5s ease-out forwards;
        }

        .animate-block-exit {
          animation: blockExit 0.5s ease-in forwards;
        }

        .animate-block-slide {
          animation: blockSlide 0.5s ease-in-out forwards;
        }

        .animate-pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }

        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Header labels */}
      <div className="flex items-center space-x-2 mb-2 px-2">
        <div className="flex-1 flex items-center justify-end">
          <div className="flex items-center text-xs font-medium text-warning-600 dark:text-warning-400 uppercase tracking-wider opacity-90">
            <span className="w-2 h-2 rounded-full bg-warning-500 animate-pulse mr-2" />
            <span>Mempool (Pending)</span>
          </div>
        </div>
        <div className="w-8 flex justify-center">
          <ArrowRight className="w-4 h-4 text-sanctuary-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center text-xs font-medium text-success-600 dark:text-success-400 uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-success-500 mr-2" />
            <span>Blockchain (Confirmed)</span>
          </div>
        </div>
      </div>

      {/* Blocks container */}
      <div className={`relative flex items-center justify-center ${compact ? 'space-x-1.5' : 'space-x-2 sm:space-x-3'} overflow-x-auto overflow-y-visible pb-6 px-4 scrollbar-hide`}>
        {/* Center divider line */}
        <div className="absolute left-1/2 top-0 bottom-4 w-px bg-gradient-to-b from-transparent via-sanctuary-300 to-transparent dark:via-sanctuary-700 -ml-0.5 z-0" />

        {displayBlocks.length === 0 ? (
          <div className="text-center text-sanctuary-500 dark:text-sanctuary-400 py-8">
            <div className="animate-pulse flex space-x-2 justify-center">
              {[...Array(compact ? 7 : 6)].map((_, i) => (
                <div
                  key={i}
                  className={`${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32'} rounded-lg bg-sanctuary-200 dark:bg-sanctuary-800`}
                />
              ))}
            </div>
            <p className="text-sm mt-4">Loading blockchain data...</p>
          </div>
        ) : (
          <>
            {/* Queued blocks summary (leftmost) */}
            {queuedBlocksSummary && queuedBlocksSummary.blockCount > 0 && (
              <QueuedSummaryBlock summary={queuedBlocksSummary} compact={compact} />
            )}

            {/* Pending/Mempool blocks */}
            {pendingBlocks.map((block, idx) => {
              // Mempool-block index: rightmost (closest to confirmed) = 0, leftmost = highest
              const mempoolBlockIndex = pendingBlocks.length - 1 - idx;
              return (
                <Block
                  key={`pending-${block.height}-${idx}`}
                  block={block}
                  index={idx}
                  onClick={() => handleBlockClick(block, mempoolBlockIndex)}
                  compact={compact}
                  isAnimating={isAnimating && newBlockDetected}
                  animationDirection="none"
                  pendingTxs={getTxsForBlock(block, pendingTxs, idx, pendingBlocks.length, pendingBlocks)}
                  explorerUrl={explorerUrl}
                />
              );
            })}

            {/* Confirmed blocks */}
            {confirmedBlocks.map((block, idx) => (
              <Block
                key={`confirmed-${block.height}`}
                block={block}
                index={idx + pendingBlocks.length}
                onClick={() => handleBlockClick(block)}
                compact={compact}
                isAnimating={isAnimating && newBlockDetected && idx === 0}
                animationDirection={isAnimating && newBlockDetected && idx === 0 ? 'enter' : 'none'}
                explorerUrl={explorerUrl}
              />
            ))}
          </>
        )}
      </div>

      {/* Legend / Info bar - block fullness indicator */}
      <div className="flex items-center justify-center space-x-4 text-[10px] font-medium text-sanctuary-700 dark:text-sanctuary-400 mt-1">
        <span>Block Fullness:</span>
        <div className="flex items-center space-x-1">
          <div className="w-10 h-1.5 rounded-sm bg-sanctuary-300 dark:bg-sanctuary-800 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1/4 bg-sanctuary-500 dark:bg-sanctuary-500 rounded-sm" />
          </div>
          <span>25%</span>
        </div>
        <div className="flex items-center space-x-1">
          <div className="w-10 h-1.5 rounded-sm bg-sanctuary-300 dark:bg-sanctuary-800 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-full bg-sanctuary-500 dark:bg-sanctuary-500 rounded-sm" />
          </div>
          <span>100%</span>
        </div>
        <span className="text-sanctuary-500 dark:text-sanctuary-500 ml-2">• Hover for details</span>
      </div>
    </div>
  );
};
