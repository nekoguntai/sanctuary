/**
 * Devices - Models Router
 *
 * Public device catalog endpoints (no auth required)
 */

import { Router, Request, Response } from 'express';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('DEVICES:MODELS');

/**
 * GET /api/v1/devices/models
 * Get all available hardware device models (public endpoint)
 */
router.get('/models', async (req: Request, res: Response) => {
  try {
    const { manufacturer, airGapped, connectivity } = req.query;

    const filters: any = {};

    // Filter by manufacturer
    if (manufacturer) {
      filters.manufacturer = manufacturer as string;
    }

    // Filter by air-gapped capability
    if (airGapped !== undefined) {
      filters.airGapped = airGapped === 'true';
    }

    // Filter by connectivity type
    if (connectivity) {
      filters.connectivity = {
        has: connectivity as string,
      };
    }

    // Don't show discontinued by default
    if (!req.query.showDiscontinued) {
      filters.discontinued = false;
    }

    const models = await prisma.hardwareDeviceModel.findMany({
      where: filters,
      orderBy: [
        { manufacturer: 'asc' },
        { name: 'asc' },
      ],
    });

    res.json(models);
  } catch (error) {
    log.error('Get device models error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch device models',
    });
  }
});

/**
 * GET /api/v1/devices/models/:slug
 * Get a specific device model by slug (public endpoint)
 */
router.get('/models/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const model = await prisma.hardwareDeviceModel.findUnique({
      where: { slug },
    });

    if (!model) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Device model not found',
      });
    }

    res.json(model);
  } catch (error) {
    log.error('Get device model error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch device model',
    });
  }
});

/**
 * GET /api/v1/devices/models/manufacturers
 * Get list of all manufacturers (public endpoint)
 */
router.get('/manufacturers', async (req: Request, res: Response) => {
  try {
    const manufacturers = await prisma.hardwareDeviceModel.findMany({
      where: { discontinued: false },
      select: { manufacturer: true },
      distinct: ['manufacturer'],
      orderBy: { manufacturer: 'asc' },
    });

    res.json(manufacturers.map(m => m.manufacturer));
  } catch (error) {
    log.error('Get manufacturers error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch manufacturers',
    });
  }
});

export default router;
