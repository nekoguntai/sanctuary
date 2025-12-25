/**
 * Send Transaction Reducer
 *
 * Handles all state transitions for the transaction wizard.
 * Pure function - no side effects, easy to test.
 */

import type {
  TransactionState,
  TransactionAction,
  WizardStep,
  OutputEntry,
} from './types';
import { WIZARD_STEPS, getNextStep, getPrevStep, deserializeState } from './types';

// ============================================================================
// INITIAL STATE
// ============================================================================

/**
 * Create initial transaction state
 * @param defaultFeeRate - Default fee rate to use (from fee estimates)
 */
export function createInitialState(defaultFeeRate = 1): TransactionState {
  return {
    // Wizard navigation
    currentStep: 'type',
    completedSteps: new Set<WizardStep>(),

    // Transaction type
    transactionType: null,

    // Outputs
    outputs: [{ address: '', amount: '', sendMax: false }],
    outputsValid: [null],
    scanningOutputIndex: null,

    // Coin control
    showCoinControl: false,
    selectedUTXOs: new Set<string>(),

    // Fees
    feeRate: defaultFeeRate,
    rbfEnabled: true,
    subtractFees: false,

    // Decoys (Stonewall)
    useDecoys: false,
    decoyCount: 2,

    // Payjoin
    payjoinUrl: null,
    payjoinStatus: 'idle',

    // Signing state
    signingDeviceId: null,
    expandedDeviceId: null,
    signedDevices: new Set<string>(),
    unsignedPsbt: null,
    showPsbtOptions: false,
    psbtDeviceId: null,

    // Draft
    draftId: null,
    isDraftMode: false,

    // UI state
    isSubmitting: false,
    error: null,
  };
}

// ============================================================================
// REDUCER
// ============================================================================

export function transactionReducer(
  state: TransactionState,
  action: TransactionAction
): TransactionState {
  switch (action.type) {
    // ========================================================================
    // NAVIGATION
    // ========================================================================

    case 'GO_TO_STEP': {
      const targetIndex = WIZARD_STEPS.indexOf(action.step);
      const currentIndex = WIZARD_STEPS.indexOf(state.currentStep);

      // Can only go to completed steps or steps before/at current
      if (targetIndex > currentIndex && !state.completedSteps.has(action.step)) {
        return state;
      }

      return { ...state, currentStep: action.step };
    }

    case 'NEXT_STEP': {
      const nextStep = getNextStep(state.currentStep);
      if (!nextStep) return state;

      // Mark current step as completed
      const newCompleted = new Set(state.completedSteps);
      newCompleted.add(state.currentStep);

      return {
        ...state,
        currentStep: nextStep,
        completedSteps: newCompleted,
      };
    }

    case 'PREV_STEP': {
      const prevStep = getPrevStep(state.currentStep);
      if (!prevStep) return state;
      return { ...state, currentStep: prevStep };
    }

    case 'MARK_STEP_COMPLETED': {
      const newCompleted = new Set(state.completedSteps);
      newCompleted.add(action.step);
      return { ...state, completedSteps: newCompleted };
    }

    case 'UNMARK_STEP_COMPLETED': {
      const newCompleted = new Set(state.completedSteps);
      newCompleted.delete(action.step);
      return { ...state, completedSteps: newCompleted };
    }

    // ========================================================================
    // TYPE SELECTION
    // ========================================================================

    case 'SET_TRANSACTION_TYPE': {
      // Set up outputs based on type
      let outputs: OutputEntry[] = state.outputs;
      let outputsValid = state.outputsValid;

      if (action.txType === 'consolidation' || action.txType === 'sweep') {
        // Consolidation/sweep: single output with sendMax
        outputs = [{ address: '', amount: '', sendMax: true }];
        outputsValid = [null];
      } else if (action.txType === 'standard' && state.transactionType !== 'standard') {
        // Reset to standard output
        outputs = [{ address: '', amount: '', sendMax: false }];
        outputsValid = [null];
      }

      return {
        ...state,
        transactionType: action.txType,
        outputs,
        outputsValid,
      };
    }

    // ========================================================================
    // OUTPUTS
    // ========================================================================

    case 'ADD_OUTPUT': {
      return {
        ...state,
        outputs: [...state.outputs, { address: '', amount: '', sendMax: false }],
        outputsValid: [...state.outputsValid, null],
      };
    }

    case 'REMOVE_OUTPUT': {
      if (state.outputs.length <= 1) return state;

      return {
        ...state,
        outputs: state.outputs.filter((_, i) => i !== action.index),
        outputsValid: state.outputsValid.filter((_, i) => i !== action.index),
      };
    }

    case 'UPDATE_OUTPUT': {
      const newOutputs = [...state.outputs];
      newOutputs[action.index] = {
        ...newOutputs[action.index],
        [action.field]: action.value,
      };

      // If setting sendMax, clear amount and unset on other outputs
      if (action.field === 'sendMax' && action.value === true) {
        newOutputs.forEach((o, i) => {
          if (i !== action.index) o.sendMax = false;
        });
        newOutputs[action.index].amount = '';
      }

      return { ...state, outputs: newOutputs };
    }

    case 'SET_OUTPUT_ADDRESS': {
      const newOutputs = [...state.outputs];
      newOutputs[action.index] = {
        ...newOutputs[action.index],
        address: action.address,
      };
      return { ...state, outputs: newOutputs };
    }

    case 'SET_OUTPUT_AMOUNT': {
      const newOutputs = [...state.outputs];
      newOutputs[action.index] = {
        ...newOutputs[action.index],
        amount: action.amount,
        displayValue: action.displayValue,
      };
      return { ...state, outputs: newOutputs };
    }

    case 'TOGGLE_SEND_MAX': {
      const newOutputs = [...state.outputs];
      const newValue = !newOutputs[action.index].sendMax;

      newOutputs[action.index] = {
        ...newOutputs[action.index],
        sendMax: newValue,
      };

      // If enabling, disable on other outputs and clear amount
      if (newValue) {
        newOutputs.forEach((o, i) => {
          if (i !== action.index) o.sendMax = false;
        });
        newOutputs[action.index].amount = '';
      }

      return { ...state, outputs: newOutputs };
    }

    case 'SET_OUTPUTS': {
      return {
        ...state,
        outputs: action.outputs,
        outputsValid: action.outputs.map(() => null),
      };
    }

    case 'SET_OUTPUTS_VALID': {
      return { ...state, outputsValid: action.valid };
    }

    case 'SET_SCANNING_OUTPUT_INDEX': {
      return { ...state, scanningOutputIndex: action.index };
    }

    // ========================================================================
    // PAYJOIN
    // ========================================================================

    case 'SET_PAYJOIN_URL': {
      return { ...state, payjoinUrl: action.url };
    }

    case 'SET_PAYJOIN_STATUS': {
      return { ...state, payjoinStatus: action.status };
    }

    // ========================================================================
    // COIN CONTROL
    // ========================================================================

    case 'TOGGLE_COIN_CONTROL': {
      return { ...state, showCoinControl: !state.showCoinControl };
    }

    case 'SET_SHOW_COIN_CONTROL': {
      return { ...state, showCoinControl: action.show };
    }

    case 'SELECT_UTXO': {
      const newSelected = new Set(state.selectedUTXOs);
      newSelected.add(action.utxoId);
      // Auto-enable coin control when selecting UTXOs
      return { ...state, selectedUTXOs: newSelected, showCoinControl: true };
    }

    case 'DESELECT_UTXO': {
      const newSelected = new Set(state.selectedUTXOs);
      newSelected.delete(action.utxoId);
      return { ...state, selectedUTXOs: newSelected };
    }

    case 'TOGGLE_UTXO': {
      const newSelected = new Set(state.selectedUTXOs);
      if (newSelected.has(action.utxoId)) {
        newSelected.delete(action.utxoId);
      } else {
        newSelected.add(action.utxoId);
      }
      // Auto-enable coin control when user selects any UTXO (switches to manual mode)
      const showCoinControl = newSelected.size > 0 ? true : state.showCoinControl;
      return { ...state, selectedUTXOs: newSelected, showCoinControl };
    }

    case 'SELECT_ALL_UTXOS': {
      // Auto-enable coin control when selecting UTXOs
      return { ...state, selectedUTXOs: new Set(action.utxoIds), showCoinControl: true };
    }

    case 'CLEAR_UTXO_SELECTION': {
      return { ...state, selectedUTXOs: new Set<string>() };
    }

    case 'SET_SELECTED_UTXOS': {
      return { ...state, selectedUTXOs: new Set(action.utxoIds) };
    }

    // ========================================================================
    // FEES
    // ========================================================================

    case 'SET_FEE_RATE': {
      return { ...state, feeRate: action.rate };
    }

    case 'TOGGLE_RBF': {
      return { ...state, rbfEnabled: !state.rbfEnabled };
    }

    case 'SET_RBF_ENABLED': {
      return { ...state, rbfEnabled: action.enabled };
    }

    case 'TOGGLE_SUBTRACT_FEES': {
      return { ...state, subtractFees: !state.subtractFees };
    }

    case 'SET_SUBTRACT_FEES': {
      return { ...state, subtractFees: action.enabled };
    }

    // ========================================================================
    // DECOYS
    // ========================================================================

    case 'TOGGLE_DECOYS': {
      return { ...state, useDecoys: !state.useDecoys };
    }

    case 'SET_USE_DECOYS': {
      return { ...state, useDecoys: action.enabled };
    }

    case 'SET_DECOY_COUNT': {
      return { ...state, decoyCount: action.count };
    }

    // ========================================================================
    // SIGNING
    // ========================================================================

    case 'SET_SIGNING_DEVICE': {
      return { ...state, signingDeviceId: action.deviceId };
    }

    case 'SET_EXPANDED_DEVICE': {
      return { ...state, expandedDeviceId: action.deviceId };
    }

    case 'MARK_DEVICE_SIGNED': {
      const newSigned = new Set(state.signedDevices);
      newSigned.add(action.deviceId);
      return { ...state, signedDevices: newSigned };
    }

    case 'SET_UNSIGNED_PSBT': {
      return { ...state, unsignedPsbt: action.psbt };
    }

    case 'TOGGLE_PSBT_OPTIONS': {
      return { ...state, showPsbtOptions: !state.showPsbtOptions };
    }

    case 'SET_SHOW_PSBT_OPTIONS': {
      return { ...state, showPsbtOptions: action.show };
    }

    case 'SET_PSBT_DEVICE_ID': {
      return { ...state, psbtDeviceId: action.deviceId };
    }

    case 'CLEAR_SIGNATURES': {
      return {
        ...state,
        signedDevices: new Set<string>(),
        unsignedPsbt: null,
        showPsbtOptions: false,
        signingDeviceId: null,
        expandedDeviceId: null,
        psbtDeviceId: null,
      };
    }

    case 'SET_SIGNED_DEVICES': {
      return { ...state, signedDevices: new Set(action.deviceIds) };
    }

    // ========================================================================
    // DRAFT
    // ========================================================================

    case 'LOAD_DRAFT': {
      const deserialized = deserializeState(action.draft);
      return {
        ...state,
        ...deserialized,
        isDraftMode: true,
      };
    }

    case 'SET_DRAFT_ID': {
      return { ...state, draftId: action.id };
    }

    case 'SET_DRAFT_MODE': {
      return { ...state, isDraftMode: action.isDraft };
    }

    // ========================================================================
    // UI
    // ========================================================================

    case 'SET_SUBMITTING': {
      return { ...state, isSubmitting: action.isSubmitting };
    }

    case 'SET_ERROR': {
      return { ...state, error: action.error };
    }

    case 'RESET': {
      return createInitialState(state.feeRate);
    }

    default:
      return state;
  }
}
