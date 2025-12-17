/**
 * Device API Routes
 *
 * API endpoints for hardware device management
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const log = createLogger('DEVICES');

const router = Router();

// ========================================
// PUBLIC ROUTES (no auth required)
// ========================================

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

// ========================================
// AUTHENTICATED ROUTES
// ========================================

// All routes below require authentication
router.use(authenticate);

/**
 * GET /api/v1/devices
 * Get all devices for authenticated user
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const devices = await prisma.device.findMany({
      where: { userId },
      include: {
        model: true, // Include hardware device model info
        wallets: {
          include: {
            wallet: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(devices);
  } catch (error) {
    log.error('Get devices error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch devices',
    });
  }
});

/**
 * POST /api/v1/devices
 * Register a new hardware device
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { type, label, fingerprint, derivationPath, xpub, modelSlug } = req.body;

    // Validation
    if (!type || !label || !fingerprint || !xpub) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'type, label, fingerprint, and xpub are required',
      });
    }

    // Check if device already exists
    const existingDevice = await prisma.device.findUnique({
      where: { fingerprint },
    });

    if (existingDevice) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Device with this fingerprint already exists',
      });
    }

    // Find the model ID if a slug was provided
    let modelId: string | undefined;
    if (modelSlug) {
      const model = await prisma.hardwareDeviceModel.findUnique({
        where: { slug: modelSlug },
      });
      if (model) {
        modelId = model.id;
      }
    }

    const device = await prisma.device.create({
      data: {
        userId,
        type,
        label,
        fingerprint,
        derivationPath,
        xpub,
        modelId,
      },
      include: {
        model: true,
      },
    });

    res.status(201).json(device);
  } catch (error) {
    log.error('Create device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register device',
    });
  }
});

/**
 * GET /api/v1/devices/:id
 * Get a specific device by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const device = await prisma.device.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        model: true, // Include hardware device model info
        wallets: {
          include: {
            wallet: {
              select: {
                id: true,
                name: true,
                type: true,
                scriptType: true,
              },
            },
          },
        },
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Device not found',
      });
    }

    res.json(device);
  } catch (error) {
    log.error('Get device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch device',
    });
  }
});

/**
 * PATCH /api/v1/devices/:id
 * Update a device (label, derivationPath, type, or model)
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { label, derivationPath, type, modelSlug } = req.body;

    const device = await prisma.device.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Device not found',
      });
    }

    // Build update data
    const updateData: any = {};
    if (label !== undefined) updateData.label = label;
    if (derivationPath !== undefined) updateData.derivationPath = derivationPath;
    if (type !== undefined) updateData.type = type;

    // If modelSlug provided, look up the model ID
    if (modelSlug) {
      const model = await prisma.hardwareDeviceModel.findUnique({
        where: { slug: modelSlug },
      });
      if (model) {
        updateData.modelId = model.id;
        // Also update the type to match the model's type
        updateData.type = model.slug;
      } else {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid device model slug',
        });
      }
    }

    const updatedDevice = await prisma.device.update({
      where: { id },
      data: updateData,
      include: {
        model: true,
      },
    });

    log.info('Device updated', { deviceId: id, userId, updates: Object.keys(updateData) });

    res.json(updatedDevice);
  } catch (error) {
    log.error('Update device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update device',
    });
  }
});

/**
 * DELETE /api/v1/devices/:id
 * Remove a device (only if not in use by any wallet)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const device = await prisma.device.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        wallets: {
          include: {
            wallet: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Device not found',
      });
    }

    // Check if device is in use by any wallet
    if (device.wallets && device.wallets.length > 0) {
      const walletNames = device.wallets.map(w => w.wallet.name).join(', ');
      return res.status(409).json({
        error: 'Conflict',
        message: `Cannot delete device. It is in use by wallet(s): ${walletNames}`,
        wallets: device.wallets.map(w => ({
          id: w.wallet.id,
          name: w.wallet.name,
        })),
      });
    }

    await prisma.device.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    log.error('Delete device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete device',
    });
  }
});

export default router;
