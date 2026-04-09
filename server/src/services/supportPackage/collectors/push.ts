/**
 * Push Notification Collector
 *
 * Collects push notification provider health and device registration counts.
 * Rounds out the notification diagnostic story alongside the Telegram collector.
 */

import { getPushService } from '../../push/pushService';
import { maintenanceRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('push', async () => {
  try {
    const pushService = getPushService();
    const health = await pushService.healthCheck();

    // Get device registration counts by platform (no PII)
    const deviceCounts = await maintenanceRepository.getPushDeviceCountsByPlatform();

    const devices: Record<string, number> = {};
    for (const group of deviceCounts) {
      devices[group.platform] = group._count._all;
    }

    return {
      health,
      devices,
      totalDevices: Object.values(devices).reduce((a, b) => a + b, 0),
    };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
