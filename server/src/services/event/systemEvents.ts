/**
 * System & Blockchain Event Emitters
 *
 * Handles emission of system lifecycle and blockchain-related events to the event bus.
 */

import { eventBus } from '../../events/eventBus';
import { createLogger } from '../../utils/logger';

const log = createLogger('EVENT_SVC');

// ===========================================================================
// System Events
// ===========================================================================

/**
 * Emit system startup event
 */
export function emitSystemStartup(version: string, environment: string): void {
  eventBus.emit('system:startup', { version, environment });
  log.info('Emitted system:startup', { version, environment });
}

/**
 * Emit system shutdown event
 */
export function emitSystemShutdown(reason: string): void {
  eventBus.emit('system:shutdown', { reason });
  log.info('Emitted system:shutdown', { reason });
}

/**
 * Emit maintenance started event
 */
export function emitMaintenanceStarted(task: string): void {
  eventBus.emit('system:maintenanceStarted', { task });
  log.debug('Emitted system:maintenanceStarted', { task });
}

/**
 * Emit maintenance completed event
 */
export function emitMaintenanceCompleted(task: string, duration: number, success: boolean): void {
  eventBus.emit('system:maintenanceCompleted', { task, duration, success });
  log.debug('Emitted system:maintenanceCompleted', { task, duration, success });
}

// ===========================================================================
// Blockchain Events
// ===========================================================================

/**
 * Emit new block event
 */
export function emitNewBlock(network: string, height: number, hash: string): void {
  eventBus.emit('blockchain:newBlock', { network, height, hash });
  log.debug('Emitted blockchain:newBlock', { network, height });
}

/**
 * Emit fee estimate updated event
 */
export function emitFeeEstimateUpdated(network: string, fastestFee: number, halfHourFee: number, hourFee: number): void {
  eventBus.emit('blockchain:feeEstimateUpdated', {
    network,
    fastestFee,
    halfHourFee,
    hourFee,
  });
}

/**
 * Emit price updated event
 */
export function emitPriceUpdated(btcUsd: number, source: string): void {
  eventBus.emit('blockchain:priceUpdated', { btcUsd, source });
  log.debug('Emitted blockchain:priceUpdated', { btcUsd, source });
}
