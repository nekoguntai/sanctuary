/**
 * usePayjoin Hook
 *
 * Manages Payjoin negotiation state. The actual Payjoin attempt is performed
 * during transaction creation (in the orchestrator), but this hook owns
 * the status tracking and the guard ref that prevents duplicate attempts.
 */

import { useState, useRef, useCallback } from 'react';

export type PayjoinStatus = 'idle' | 'attempting' | 'success' | 'failed';

export interface UsePayjoinResult {
  payjoinStatus: PayjoinStatus;
  payjoinAttempted: React.RefObject<boolean>;
  setPayjoinStatus: (status: PayjoinStatus) => void;
  resetPayjoin: () => void;
}

export function usePayjoin(): UsePayjoinResult {
  const [payjoinStatus, setPayjoinStatus] = useState<PayjoinStatus>('idle');
  const payjoinAttempted = useRef(false);

  const resetPayjoin = useCallback(() => {
    setPayjoinStatus('idle');
    payjoinAttempted.current = false;
  }, []);

  return {
    payjoinStatus,
    payjoinAttempted,
    setPayjoinStatus,
    resetPayjoin,
  };
}
