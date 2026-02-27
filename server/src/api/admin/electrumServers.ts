/**
 * Admin Electrum Servers Router
 *
 * Endpoints for managing Electrum server configuration (admin only)
 */

import { Router, Request, Response } from 'express';
import { db as prisma } from '../../repositories/db';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { testNodeConfig } from '../../services/bitcoin/nodeClient';
import { reloadElectrumServers } from '../../services/bitcoin/electrumPool';

const router = Router();
const log = createLogger('ADMIN:ELECTRUM');

/**
 * GET /api/v1/admin/electrum-servers
 * Get all Electrum servers for the default node config
 * Query params:
 *   - network: Filter by network (mainnet, testnet, signet, regtest)
 */
router.get('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { network } = req.query;

    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    if (!nodeConfig) {
      return res.json([]);
    }

    const where: any = { nodeConfigId: nodeConfig.id };
    if (network) {
      where.network = network;
    }

    const servers = await prisma.electrumServer.findMany({
      where,
      orderBy: { priority: 'asc' },
    });

    res.json(servers);
  } catch (error) {
    log.error('Get electrum servers error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Electrum servers',
    });
  }
});

/**
 * POST /api/v1/admin/electrum-servers/test-connection
 * Test connection to an Electrum server with arbitrary host/port/ssl
 * NOTE: This route MUST be defined before /:network and /:id to avoid route conflicts
 */
router.post('/test-connection', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { host, port, useSsl } = req.body;

    if (!host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Host and port are required',
      });
    }

    // Test connection using nodeClient's testNodeConfig
    const result = await testNodeConfig({
      host,
      port: parseInt(port, 10),
      protocol: useSsl ? 'ssl' : 'tcp',
    });

    log.info('Electrum connection test result', {
      host,
      port,
      useSsl,
      success: result.success,
      message: result.message,
    });

    res.json({
      success: result.success,
      message: result.message,
      blockHeight: result.info?.blockHeight,
    });
  } catch (error) {
    log.error('Test electrum connection error', { error: String(error) });
    res.status(500).json({
      success: false,
      message: 'Failed to test Electrum connection',
    });
  }
});

/**
 * PUT /api/v1/admin/electrum-servers/reorder
 * Reorder Electrum servers (update priorities)
 * NOTE: This route MUST be defined before /:id to avoid ":id = 'reorder'" matching
 */
router.put('/reorder', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { serverIds } = req.body;

    if (!Array.isArray(serverIds)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'serverIds must be an array',
      });
    }

    // Update priorities based on array order
    await Promise.all(
      serverIds.map((id: string, index: number) =>
        prisma.electrumServer.update({
          where: { id },
          data: { priority: index },
        })
      )
    );

    log.info('Electrum servers reordered', { count: serverIds.length });

    // Reload pool to pick up new order (more graceful than full reset)
    await reloadElectrumServers();

    res.json({ success: true, message: 'Servers reordered' });
  } catch (error) {
    log.error('Reorder electrum servers error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to reorder Electrum servers',
    });
  }
});

/**
 * GET /api/v1/admin/electrum-servers/:network
 * Get Electrum servers for a specific network
 */
router.get('/:network', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { network } = req.params;

    // Validate network
    const validNetworks = ['mainnet', 'testnet', 'signet', 'regtest'];
    if (!validNetworks.includes(network)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid network. Must be one of: ${validNetworks.join(', ')}`,
      });
    }

    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    if (!nodeConfig) {
      return res.json([]);
    }

    const servers = await prisma.electrumServer.findMany({
      where: {
        nodeConfigId: nodeConfig.id,
        network,
      },
      orderBy: { priority: 'asc' },
    });

    res.json(servers);
  } catch (error) {
    log.error('Get electrum servers by network error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Electrum servers',
    });
  }
});

/**
 * POST /api/v1/admin/electrum-servers
 * Add a new Electrum server
 * Body params:
 *   - network: Network (mainnet, testnet, signet, regtest) - defaults to mainnet
 */
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { label, host, port, useSsl, priority, enabled, network } = req.body;

    // Validation
    if (!label || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Label, host, and port are required',
      });
    }

    const serverNetwork = network || 'mainnet';
    const validNetworks = ['mainnet', 'testnet', 'signet', 'regtest'];
    if (!validNetworks.includes(serverNetwork)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid network. Must be one of: ${validNetworks.join(', ')}`,
      });
    }

    // Check for duplicate (same host, port, and network)
    const existingServer = await prisma.electrumServer.findFirst({
      where: {
        host: host.toLowerCase(),
        port: parseInt(port.toString(), 10),
        network: serverNetwork,
      },
    });

    if (existingServer) {
      return res.status(409).json({
        error: 'Conflict',
        message: `A server with host ${host}, port ${port}, and network ${serverNetwork} already exists (${existingServer.label})`,
      });
    }

    // Get or create default node config
    let nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    if (!nodeConfig) {
      // Create default electrum config if none exists
      nodeConfig = await prisma.nodeConfig.create({
        data: {
          id: 'default',
          type: 'electrum',
          network: serverNetwork,
          host: host,
          port: parseInt(port.toString(), 10),
          useSsl: useSsl ?? true,
          isDefault: true,
        },
      });
    }

    // Get highest priority for this network to set new server at end if not specified
    const highestPriority = await prisma.electrumServer.findFirst({
      where: {
        nodeConfigId: nodeConfig.id,
        network: serverNetwork,
      },
      orderBy: { priority: 'desc' },
      select: { priority: true },
    });

    const server = await prisma.electrumServer.create({
      data: {
        nodeConfigId: nodeConfig.id,
        network: serverNetwork,
        label,
        host,
        port: parseInt(port.toString(), 10),
        useSsl: useSsl ?? true,
        priority: priority ?? (highestPriority ? highestPriority.priority + 1 : 0),
        enabled: enabled ?? true,
      },
    });

    log.info('Electrum server added', { id: server.id, label, host, port, network: serverNetwork });

    // Reload pool to pick up new server (more graceful than full reset)
    await reloadElectrumServers();

    res.status(201).json(server);
  } catch (error) {
    log.error('Add electrum server error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add Electrum server',
    });
  }
});

/**
 * PUT /api/v1/admin/electrum-servers/:id
 * Update an Electrum server
 */
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { label, host, port, useSsl, priority, enabled, network } = req.body;

    const server = await prisma.electrumServer.findUnique({
      where: { id },
    });

    if (!server) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Electrum server not found',
      });
    }

    // Validate network if provided
    const serverNetwork = network ?? server.network;
    const validNetworks = ['mainnet', 'testnet', 'signet', 'regtest'];
    if (!validNetworks.includes(serverNetwork)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid network. Must be one of: ${validNetworks.join(', ')}`,
      });
    }

    // Check for duplicate (same host, port, and network, excluding this server)
    const newHost = host ?? server.host;
    const newPort = port ? parseInt(port.toString(), 10) : server.port;
    const existingServer = await prisma.electrumServer.findFirst({
      where: {
        host: newHost.toLowerCase(),
        port: newPort,
        network: serverNetwork,
        id: { not: id },
      },
    });

    if (existingServer) {
      return res.status(409).json({
        error: 'Conflict',
        message: `A server with host ${newHost}, port ${newPort}, and network ${serverNetwork} already exists (${existingServer.label})`,
      });
    }

    const updatedServer = await prisma.electrumServer.update({
      where: { id },
      data: {
        label: label ?? server.label,
        host: host ?? server.host,
        port: port ? parseInt(port.toString(), 10) : server.port,
        useSsl: useSsl ?? server.useSsl,
        priority: priority ?? server.priority,
        enabled: enabled ?? server.enabled,
        network: serverNetwork,
        updatedAt: new Date(),
      },
    });

    log.info('Electrum server updated', { id, label: updatedServer.label, network: updatedServer.network });

    // Reload pool to pick up changes (more graceful than full reset)
    await reloadElectrumServers();

    res.json(updatedServer);
  } catch (error) {
    log.error('Update electrum server error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update Electrum server',
    });
  }
});

/**
 * DELETE /api/v1/admin/electrum-servers/:id
 * Delete an Electrum server
 */
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const server = await prisma.electrumServer.findUnique({
      where: { id },
    });

    if (!server) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Electrum server not found',
      });
    }

    await prisma.electrumServer.delete({
      where: { id },
    });

    log.info('Electrum server deleted', { id, label: server.label });

    // Reload pool to pick up changes (more graceful than full reset)
    await reloadElectrumServers();

    res.json({ success: true, message: 'Server deleted' });
  } catch (error) {
    log.error('Delete electrum server error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete Electrum server',
    });
  }
});

/**
 * POST /api/v1/admin/electrum-servers/:id/test
 * Test connection to a specific Electrum server
 */
router.post('/:id/test', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const server = await prisma.electrumServer.findUnique({
      where: { id },
    });

    if (!server) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Electrum server not found',
      });
    }

    // Test connection using nodeClient's testNodeConfig
    const result = await testNodeConfig({
      host: server.host,
      port: server.port,
      protocol: server.useSsl ? 'ssl' : 'tcp',
    });

    // Update health status and capability info based on test result
    await prisma.electrumServer.update({
      where: { id },
      data: {
        lastHealthCheck: new Date(),
        isHealthy: result.success,
        healthCheckFails: result.success ? 0 : server.healthCheckFails + 1,
        lastHealthCheckError: result.success ? null : result.message,
        // Update verbose capability if we got a result
        ...(result.info?.supportsVerbose !== undefined && {
          supportsVerbose: result.info.supportsVerbose,
          lastCapabilityCheck: new Date(),
        }),
      },
    });

    log.info('Electrum server test result', {
      serverId: id,
      success: result.success,
      message: result.message,
      info: result.info,
      supportsVerbose: result.info?.supportsVerbose,
    });

    res.json({
      success: result.success,
      message: result.message,
      error: result.success ? undefined : result.message,
      info: result.info,
    });
  } catch (error) {
    log.error('Test electrum server error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to test Electrum server',
    });
  }
});

export default router;
