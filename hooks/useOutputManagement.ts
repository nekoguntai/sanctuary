/**
 * useOutputManagement Hook
 *
 * Manages multi-output transaction state for SendTransaction.
 * Handles adding, removing, and updating outputs with validation tracking.
 *
 * Extracted from SendTransaction.tsx for maintainability.
 */

import { useState, useCallback } from 'react';

export interface OutputEntry {
  address: string;
  amount: string;
  sendMax?: boolean;
  displayValue?: string; // Temporary display value while typing decimals
}

export interface UseOutputManagementOptions {
  initialOutputs?: OutputEntry[];
}

export interface UseOutputManagementResult {
  // State
  outputs: OutputEntry[];
  outputsValid: (boolean | null)[];
  scanningOutputIndex: number | null;

  // Derived values
  isSendMax: boolean;

  // Handlers
  addOutput: () => void;
  removeOutput: (index: number) => void;
  updateOutput: (index: number, field: keyof OutputEntry, value: string | boolean | undefined) => void;
  toggleSendMax: (index: number) => void;
  setOutputsValid: React.Dispatch<React.SetStateAction<(boolean | null)[]>>;
  setScanningOutputIndex: React.Dispatch<React.SetStateAction<number | null>>;

  // Setters for external updates (e.g., loading from draft)
  setOutputs: React.Dispatch<React.SetStateAction<OutputEntry[]>>;
}

export function useOutputManagement(
  options: UseOutputManagementOptions = {}
): UseOutputManagementResult {
  const { initialOutputs = [{ address: '', amount: '', sendMax: false }] } = options;

  // Core state
  const [outputs, setOutputs] = useState<OutputEntry[]>(initialOutputs);
  const [outputsValid, setOutputsValid] = useState<(boolean | null)[]>(
    initialOutputs.map(() => null)
  );
  const [scanningOutputIndex, setScanningOutputIndex] = useState<number | null>(null);

  // Derived values
  const isSendMax = outputs.some(o => o.sendMax);

  // Add a new empty output
  const addOutput = useCallback(() => {
    setOutputs(prev => [...prev, { address: '', amount: '', sendMax: false }]);
    setOutputsValid(prev => [...prev, null]);
  }, []);

  // Remove an output by index (keeps at least one)
  const removeOutput = useCallback((index: number) => {
    setOutputs(prev => {
      if (prev.length > 1) {
        return prev.filter((_, i) => i !== index);
      }
      return prev;
    });
    setOutputsValid(prev => {
      if (prev.length > 1) {
        return prev.filter((_, i) => i !== index);
      }
      return prev;
    });
  }, []);

  // Update a specific field of an output
  const updateOutput = useCallback((
    index: number,
    field: keyof OutputEntry,
    value: string | boolean | undefined
  ) => {
    setOutputs(prev => {
      const newOutputs = [...prev];
      newOutputs[index] = { ...newOutputs[index], [field]: value };

      // If setting sendMax, clear the amount and unset sendMax on other outputs
      if (field === 'sendMax' && value === true) {
        newOutputs.forEach((o, i) => {
          if (i !== index) o.sendMax = false;
        });
        newOutputs[index].amount = '';
      }

      return newOutputs;
    });
  }, []);

  // Toggle sendMax for an output
  const toggleSendMax = useCallback((index: number) => {
    setOutputs(prev => {
      const newOutputs = [...prev];
      const newValue = !newOutputs[index].sendMax;
      newOutputs[index] = { ...newOutputs[index], sendMax: newValue };

      // If enabling sendMax, disable on other outputs and clear amount
      if (newValue) {
        newOutputs.forEach((o, i) => {
          if (i !== index) o.sendMax = false;
        });
        newOutputs[index].amount = '';
      }

      return newOutputs;
    });
  }, []);

  return {
    // State
    outputs,
    outputsValid,
    scanningOutputIndex,

    // Derived
    isSendMax,

    // Handlers
    addOutput,
    removeOutput,
    updateOutput,
    toggleSendMax,
    setOutputsValid,
    setScanningOutputIndex,

    // Setters
    setOutputs,
  };
}
