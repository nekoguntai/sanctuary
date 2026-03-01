/**
 * User Event Emitters
 *
 * Handles emission of user-related events to the event bus.
 */

import { eventBus } from '../../events/eventBus';
import { createLogger } from '../../utils/logger';
import type { UserLoginData } from './types';

const log = createLogger('EVENT_SVC');

/**
 * Emit user login event
 */
export function emitUserLogin(data: UserLoginData): void {
  eventBus.emit('user:login', data);
  log.info('Emitted user:login', { userId: data.userId, username: data.username });
}

/**
 * Emit user logout event
 */
export function emitUserLogout(userId: string): void {
  eventBus.emit('user:logout', { userId });
  log.debug('Emitted user:logout', { userId });
}

/**
 * Emit user created event
 */
export function emitUserCreated(userId: string, username: string): void {
  eventBus.emit('user:created', { userId, username });
  log.info('Emitted user:created', { userId, username });
}

/**
 * Emit password changed event
 */
export function emitPasswordChanged(userId: string): void {
  eventBus.emit('user:passwordChanged', { userId });
  log.info('Emitted user:passwordChanged', { userId });
}

/**
 * Emit 2FA enabled event
 */
export function emitTwoFactorEnabled(userId: string): void {
  eventBus.emit('user:twoFactorEnabled', { userId });
  log.info('Emitted user:twoFactorEnabled', { userId });
}

/**
 * Emit 2FA disabled event
 */
export function emitTwoFactorDisabled(userId: string): void {
  eventBus.emit('user:twoFactorDisabled', { userId });
  log.info('Emitted user:twoFactorDisabled', { userId });
}
