import React, { useEffect, useState } from 'react';
import { Blocks } from 'lucide-react';
import * as bitcoinApi from '../../src/api/bitcoin';
import { createLogger } from '../../utils/logger';

const log = createLogger('BlockHeight');

/**
 * Compact block height display for the sidebar footer.
 * Shows the current Bitcoin block height with a subtle tick animation on new blocks.
 */
export const BlockHeightIndicator: React.FC = () => {
  const [blockHeight, setBlockHeight] = useState<number | null>(null);
  const [tick, setTick] = useState(false);

  useEffect(() => {
    const fetchHeight = async () => {
      try {
        const status = await bitcoinApi.getStatus();
        if (status.blockHeight) {
          setBlockHeight(prev => {
            if (prev !== null && prev !== status.blockHeight) {
              setTick(true);
              setTimeout(() => setTick(false), 1500);
            }
            return status.blockHeight!;
          });
        }
      } catch (error) {
        log.debug('Failed to fetch block height');
      }
    };

    fetchHeight();
    const interval = setInterval(fetchHeight, 30000);
    return () => clearInterval(interval);
  }, []);

  if (blockHeight === null) return null;

  return (
    <div className={`flex items-center gap-1.5 text-[10px] text-sanctuary-400 transition-colors ${tick ? 'text-success-500' : ''}`} title="Current block height">
      <Blocks className={`w-3 h-3 transition-transform ${tick ? 'scale-110' : ''}`} />
      <span className="font-mono tabular-nums">{blockHeight.toLocaleString()}</span>
    </div>
  );
};
