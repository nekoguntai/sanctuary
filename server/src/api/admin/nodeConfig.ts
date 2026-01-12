/**
 * Admin Node Config Router
 *
 * Endpoints for Bitcoin node configuration management (admin only)
 */

import { Router, Request, Response } from 'express';
import prisma from '../../models/prisma';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { testNodeConfig, resetNodeClient, NodeConfig } from '../../services/bitcoin/nodeClient';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { encrypt } from '../../utils/encryption';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';

const router = Router();
const log = createLogger('ADMIN:NODECONFIG');

/**
 * GET /api/v1/admin/node-config
 * Get the global node configuration (admin only)
 */
router.get('/node-config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    // Get the default node config with servers
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
      include: {
        servers: {
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (!nodeConfig) {
      // Return default configuration if none exists - use public Blockstream server
      return res.json({
        type: 'electrum',
        host: 'electrum.blockstream.info',
        port: '50002',
        useSsl: true,
        allowSelfSignedCert: false, // Verify certificates by default
        user: null,
        hasPassword: false,
        explorerUrl: 'https://mempool.space',
        feeEstimatorUrl: 'https://mempool.space',
        mempoolEstimator: 'simple',
        poolEnabled: true,
        poolMinConnections: 1,
        poolMaxConnections: 5,
        poolLoadBalancing: 'round_robin',
        servers: [],
      });
    }

    res.json({
      type: nodeConfig.type,
      // Legacy singleton config (deprecated)
      host: nodeConfig.host,
      port: nodeConfig.port.toString(),
      useSsl: nodeConfig.useSsl,
      allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
      explorerUrl: nodeConfig.explorerUrl,
      feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space',
      mempoolEstimator: nodeConfig.mempoolEstimator || 'simple',
      // Legacy pool settings (deprecated)
      poolEnabled: nodeConfig.poolEnabled,
      poolMinConnections: nodeConfig.poolMinConnections,
      poolMaxConnections: nodeConfig.poolMaxConnections,
      poolLoadBalancing: nodeConfig.poolLoadBalancing || 'round_robin',
      servers: nodeConfig.servers,
      // Per-network settings (new)
      mainnetMode: nodeConfig.mainnetMode,
      mainnetSingletonHost: nodeConfig.mainnetSingletonHost,
      mainnetSingletonPort: nodeConfig.mainnetSingletonPort,
      mainnetSingletonSsl: nodeConfig.mainnetSingletonSsl,
      mainnetPoolMin: nodeConfig.mainnetPoolMin,
      mainnetPoolMax: nodeConfig.mainnetPoolMax,
      mainnetPoolLoadBalancing: nodeConfig.mainnetPoolLoadBalancing,
      testnetEnabled: nodeConfig.testnetEnabled,
      testnetMode: nodeConfig.testnetMode,
      testnetSingletonHost: nodeConfig.testnetSingletonHost,
      testnetSingletonPort: nodeConfig.testnetSingletonPort,
      testnetSingletonSsl: nodeConfig.testnetSingletonSsl,
      testnetPoolMin: nodeConfig.testnetPoolMin,
      testnetPoolMax: nodeConfig.testnetPoolMax,
      testnetPoolLoadBalancing: nodeConfig.testnetPoolLoadBalancing,
      signetEnabled: nodeConfig.signetEnabled,
      signetMode: nodeConfig.signetMode,
      signetSingletonHost: nodeConfig.signetSingletonHost,
      signetSingletonPort: nodeConfig.signetSingletonPort,
      signetSingletonSsl: nodeConfig.signetSingletonSsl,
      signetPoolMin: nodeConfig.signetPoolMin,
      signetPoolMax: nodeConfig.signetPoolMax,
      signetPoolLoadBalancing: nodeConfig.signetPoolLoadBalancing,
      // Proxy settings
      proxyEnabled: nodeConfig.proxyEnabled ?? false,
      proxyHost: nodeConfig.proxyHost,
      proxyPort: nodeConfig.proxyPort,
      proxyUsername: nodeConfig.proxyUsername,
      proxyPassword: nodeConfig.proxyPassword ? '********' : undefined, // Mask password
    });
  } catch (error) {
    log.error('Get node config error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get node configuration',
    });
  }
});

/**
 * PUT /api/v1/admin/node-config
 * Update the global node configuration (admin only)
 */
router.put('/node-config', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      type, host, port, useSsl, allowSelfSignedCert, user, password, explorerUrl, feeEstimatorUrl, mempoolEstimator,
      poolEnabled, poolMinConnections, poolMaxConnections, poolLoadBalancing,
      proxyEnabled, proxyHost, proxyPort, proxyUsername, proxyPassword,
      // Per-network settings
      mainnetMode, mainnetSingletonHost, mainnetSingletonPort, mainnetSingletonSsl,
      mainnetPoolMin, mainnetPoolMax, mainnetPoolLoadBalancing,
      testnetEnabled, testnetMode, testnetSingletonHost, testnetSingletonPort, testnetSingletonSsl,
      testnetPoolMin, testnetPoolMax, testnetPoolLoadBalancing,
      signetEnabled, signetMode, signetSingletonHost, signetSingletonPort, signetSingletonSsl,
      signetPoolMin, signetPoolMax, signetPoolLoadBalancing,
    } = req.body;
    // Log non-sensitive fields only (password excluded)
    log.info('PUT /node-config', { type, host, port, useSsl, allowSelfSignedCert, hasPassword: !!password, mempoolEstimator, poolEnabled, poolMinConnections, poolMaxConnections, poolLoadBalancing, proxyEnabled, proxyHost, proxyPort, mainnetMode, testnetEnabled, testnetMode, signetEnabled, signetMode });

    // Validation
    if (!type || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Type, host, and port are required',
      });
    }

    // Only Electrum is supported
    if (type && type !== 'electrum') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Only Electrum connection type is supported',
      });
    }

    // Check if a default config exists
    const existingConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    let nodeConfig;

    // Validate mempoolEstimator if provided
    const validEstimators = ['simple', 'mempool_space'];
    const estimator = mempoolEstimator && validEstimators.includes(mempoolEstimator) ? mempoolEstimator : 'simple';

    // Validate load balancing strategy
    const validLoadBalancing = ['round_robin', 'least_connections', 'failover_only'];
    const loadBalancing = poolLoadBalancing && validLoadBalancing.includes(poolLoadBalancing) ? poolLoadBalancing : 'round_robin';

    if (existingConfig) {
      // Update existing config
      nodeConfig = await prisma.nodeConfig.update({
        where: { id: existingConfig.id },
        data: {
          type,
          host,
          port: parseInt(port.toString(), 10),
          useSsl: useSsl === true,
          allowSelfSignedCert: allowSelfSignedCert === true, // Opt-in to disable certificate verification
          explorerUrl: explorerUrl || 'https://mempool.space',
          feeEstimatorUrl: feeEstimatorUrl || null,
          mempoolEstimator: estimator,
          // poolEnabled should be true if mainnetMode is 'pool'
          poolEnabled: poolEnabled ?? (mainnetMode === 'pool' || mainnetMode === undefined),
          poolMinConnections: poolMinConnections ?? 1,
          poolMaxConnections: poolMaxConnections ?? 5,
          poolLoadBalancing: loadBalancing,
          // Proxy settings
          proxyEnabled: proxyEnabled ?? false,
          proxyHost: proxyHost || null,
          proxyPort: proxyPort ? parseInt(proxyPort.toString(), 10) : null,
          proxyUsername: proxyUsername || null,
          proxyPassword: proxyPassword ? encrypt(proxyPassword) : null,
          // Per-network settings - Mainnet
          mainnetMode: mainnetMode || 'pool',
          mainnetSingletonHost: mainnetSingletonHost || 'electrum.blockstream.info',
          mainnetSingletonPort: mainnetSingletonPort ? parseInt(mainnetSingletonPort.toString(), 10) : 50002,
          mainnetSingletonSsl: mainnetSingletonSsl ?? true,
          mainnetPoolMin: mainnetPoolMin ? parseInt(mainnetPoolMin.toString(), 10) : 1,
          mainnetPoolMax: mainnetPoolMax ? parseInt(mainnetPoolMax.toString(), 10) : 5,
          mainnetPoolLoadBalancing: mainnetPoolLoadBalancing || 'round_robin',
          // Per-network settings - Testnet
          testnetEnabled: testnetEnabled ?? false,
          testnetMode: testnetMode || 'singleton',
          testnetSingletonHost: testnetSingletonHost || 'electrum.blockstream.info',
          testnetSingletonPort: testnetSingletonPort ? parseInt(testnetSingletonPort.toString(), 10) : 60002,
          testnetSingletonSsl: testnetSingletonSsl ?? true,
          testnetPoolMin: testnetPoolMin ? parseInt(testnetPoolMin.toString(), 10) : 1,
          testnetPoolMax: testnetPoolMax ? parseInt(testnetPoolMax.toString(), 10) : 3,
          testnetPoolLoadBalancing: testnetPoolLoadBalancing || 'round_robin',
          // Per-network settings - Signet
          signetEnabled: signetEnabled ?? false,
          signetMode: signetMode || 'singleton',
          signetSingletonHost: signetSingletonHost || 'electrum.mutinynet.com',
          signetSingletonPort: signetSingletonPort ? parseInt(signetSingletonPort.toString(), 10) : 50002,
          signetSingletonSsl: signetSingletonSsl ?? true,
          signetPoolMin: signetPoolMin ? parseInt(signetPoolMin.toString(), 10) : 1,
          signetPoolMax: signetPoolMax ? parseInt(signetPoolMax.toString(), 10) : 3,
          signetPoolLoadBalancing: signetPoolLoadBalancing || 'round_robin',
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new config
      nodeConfig = await prisma.nodeConfig.create({
        data: {
          id: 'default',
          type,
          host,
          port: parseInt(port.toString(), 10),
          useSsl: useSsl === true,
          allowSelfSignedCert: allowSelfSignedCert === true, // Opt-in to disable certificate verification
          explorerUrl: explorerUrl || 'https://mempool.space',
          feeEstimatorUrl: feeEstimatorUrl || null,
          mempoolEstimator: estimator,
          // poolEnabled should be true if mainnetMode is 'pool'
          poolEnabled: poolEnabled ?? (mainnetMode === 'pool' || mainnetMode === undefined),
          poolMinConnections: poolMinConnections ?? 1,
          poolMaxConnections: poolMaxConnections ?? 5,
          poolLoadBalancing: loadBalancing,
          // Proxy settings
          proxyEnabled: proxyEnabled ?? false,
          proxyHost: proxyHost || null,
          proxyPort: proxyPort ? parseInt(proxyPort.toString(), 10) : null,
          proxyUsername: proxyUsername || null,
          proxyPassword: proxyPassword ? encrypt(proxyPassword) : null,
          // Per-network settings - Mainnet
          mainnetMode: mainnetMode || 'pool',
          mainnetSingletonHost: mainnetSingletonHost || 'electrum.blockstream.info',
          mainnetSingletonPort: mainnetSingletonPort ? parseInt(mainnetSingletonPort.toString(), 10) : 50002,
          mainnetSingletonSsl: mainnetSingletonSsl ?? true,
          mainnetPoolMin: mainnetPoolMin ? parseInt(mainnetPoolMin.toString(), 10) : 1,
          mainnetPoolMax: mainnetPoolMax ? parseInt(mainnetPoolMax.toString(), 10) : 5,
          mainnetPoolLoadBalancing: mainnetPoolLoadBalancing || 'round_robin',
          // Per-network settings - Testnet
          testnetEnabled: testnetEnabled ?? false,
          testnetMode: testnetMode || 'singleton',
          testnetSingletonHost: testnetSingletonHost || 'electrum.blockstream.info',
          testnetSingletonPort: testnetSingletonPort ? parseInt(testnetSingletonPort.toString(), 10) : 60002,
          testnetSingletonSsl: testnetSingletonSsl ?? true,
          testnetPoolMin: testnetPoolMin ? parseInt(testnetPoolMin.toString(), 10) : 1,
          testnetPoolMax: testnetPoolMax ? parseInt(testnetPoolMax.toString(), 10) : 3,
          testnetPoolLoadBalancing: testnetPoolLoadBalancing || 'round_robin',
          // Per-network settings - Signet
          signetEnabled: signetEnabled ?? false,
          signetMode: signetMode || 'singleton',
          signetSingletonHost: signetSingletonHost || 'electrum.mutinynet.com',
          signetSingletonPort: signetSingletonPort ? parseInt(signetSingletonPort.toString(), 10) : 50002,
          signetSingletonSsl: signetSingletonSsl ?? true,
          signetPoolMin: signetPoolMin ? parseInt(signetPoolMin.toString(), 10) : 1,
          signetPoolMax: signetPoolMax ? parseInt(signetPoolMax.toString(), 10) : 3,
          signetPoolLoadBalancing: signetPoolLoadBalancing || 'round_robin',
          isDefault: true,
        },
      });
    }

    log.info('Node config updated:', { type, host, port });

    // Audit log
    await auditService.logFromRequest(req, AuditAction.NODE_CONFIG_UPDATE, AuditCategory.ADMIN, {
      details: { type, host, port },
    });

    // Reset the active node client so it reconnects with new config
    await resetNodeClient();

    res.json({
      type: nodeConfig.type,
      host: nodeConfig.host,
      port: nodeConfig.port.toString(),
      useSsl: nodeConfig.useSsl,
      allowSelfSignedCert: nodeConfig.allowSelfSignedCert ?? false,
      explorerUrl: nodeConfig.explorerUrl,
      feeEstimatorUrl: nodeConfig.feeEstimatorUrl || 'https://mempool.space',
      mempoolEstimator: nodeConfig.mempoolEstimator || 'simple',
      poolEnabled: nodeConfig.poolEnabled,
      poolMinConnections: nodeConfig.poolMinConnections,
      poolMaxConnections: nodeConfig.poolMaxConnections,
      poolLoadBalancing: nodeConfig.poolLoadBalancing || 'round_robin',
      // Per-network settings
      mainnetMode: nodeConfig.mainnetMode,
      mainnetSingletonHost: nodeConfig.mainnetSingletonHost,
      mainnetSingletonPort: nodeConfig.mainnetSingletonPort,
      mainnetSingletonSsl: nodeConfig.mainnetSingletonSsl,
      mainnetPoolMin: nodeConfig.mainnetPoolMin,
      mainnetPoolMax: nodeConfig.mainnetPoolMax,
      mainnetPoolLoadBalancing: nodeConfig.mainnetPoolLoadBalancing,
      testnetEnabled: nodeConfig.testnetEnabled,
      testnetMode: nodeConfig.testnetMode,
      testnetSingletonHost: nodeConfig.testnetSingletonHost,
      testnetSingletonPort: nodeConfig.testnetSingletonPort,
      testnetSingletonSsl: nodeConfig.testnetSingletonSsl,
      testnetPoolMin: nodeConfig.testnetPoolMin,
      testnetPoolMax: nodeConfig.testnetPoolMax,
      testnetPoolLoadBalancing: nodeConfig.testnetPoolLoadBalancing,
      signetEnabled: nodeConfig.signetEnabled,
      signetMode: nodeConfig.signetMode,
      signetSingletonHost: nodeConfig.signetSingletonHost,
      signetSingletonPort: nodeConfig.signetSingletonPort,
      signetSingletonSsl: nodeConfig.signetSingletonSsl,
      signetPoolMin: nodeConfig.signetPoolMin,
      signetPoolMax: nodeConfig.signetPoolMax,
      signetPoolLoadBalancing: nodeConfig.signetPoolLoadBalancing,
      message: 'Node configuration updated successfully. Backend will reconnect on next request.',
    });
  } catch (error) {
    log.error('Update node config error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update node configuration',
    });
  }
});

/**
 * POST /api/v1/admin/node-config/test
 * Test connection to node with provided configuration (admin only)
 */
router.post('/node-config/test', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { type, host, port, useSsl, user, password } = req.body;

    // Validation
    if (!type || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Type, host, and port are required',
      });
    }

    // Only Electrum is supported
    if (type && type !== 'electrum') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Only Electrum connection type is supported',
      });
    }

    // Build config for testing
    const testConfig: NodeConfig = {
      host,
      port: parseInt(port.toString(), 10),
      protocol: useSsl ? 'ssl' : 'tcp',
    };

    // Test the connection using the nodeClient abstraction
    const result = await testNodeConfig(testConfig);

    if (result.success) {
      res.json({
        success: true,
        blockHeight: result.info?.blockHeight,
        message: result.message,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Connection Failed',
        message: result.message,
      });
    }
  } catch (error) {
    log.error('Test connection error', { error: String(error) });
    res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to test node connection'),
    });
  }
});

/**
 * POST /api/v1/admin/proxy/test
 * Test SOCKS5/Tor proxy with comprehensive verification:
 * 1. Connect to a .onion address (proves Tor routing works)
 * 2. Check torproject.org to confirm Tor exit and get exit IP
 */
router.post('/proxy/test', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { host, port, username, password } = req.body;

    // Validation
    if (!host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Proxy host and port are required',
      });
    }

    const proxyPort = parseInt(port.toString(), 10);
    const { SocksClient } = await import('socks');

    // Step 1: Test .onion connectivity (definitive proof Tor works)
    const onionTarget = {
      host: 'explorerzydxu5ecjrkwceayqybizmpjjznk5izmitf2modhcusuqlid.onion',
      port: 143, // TCP Electrum port
    };

    const socksOptions = {
      proxy: {
        host,
        port: proxyPort,
        type: 5 as const,
        ...(username && password ? { userId: username, password } : {}),
      },
      command: 'connect' as const,
      destination: onionTarget,
      timeout: 30000,
    };

    try {
      const { socket } = await SocksClient.createConnection(socksOptions);
      socket.destroy();
    } catch (onionError: any) {
      log.error('.onion connection failed', { error: String(onionError) });
      return res.status(500).json({
        success: false,
        error: 'Tor Verification Failed',
        message: 'Could not reach .onion address - Tor may not be working',
      });
    }

    // Step 2: Check torproject.org to get exit IP
    let exitIp = 'unknown';
    let isTorExit = false;

    try {
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      const nodeFetch = (await import('node-fetch')).default;

      const proxyUrl = username && password
        ? `socks5://${username}:${password}@${host}:${proxyPort}`
        : `socks5://${host}:${proxyPort}`;
      const agent = new SocksProxyAgent(proxyUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      // Use node-fetch which properly supports the agent option for SOCKS proxy
      const response = await nodeFetch('https://check.torproject.org/api/ip', {
        agent,
        signal: controller.signal as any,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as { IsTor: boolean; IP: string };
        isTorExit = data.IsTor;
        exitIp = data.IP;
      }
    } catch (ipError: any) {
      // Non-fatal - .onion test already passed, just couldn't get exit IP
      log.warn('Could not fetch exit IP from torproject.org', { error: String(ipError) });
    }

    res.json({
      success: true,
      message: isTorExit
        ? `Tor verified! Exit node IP: ${exitIp}`
        : `.onion reachable, but exit check inconclusive. IP: ${exitIp}`,
      exitIp,
      isTorExit,
    });
  } catch (error) {
    log.error('Tor verification failed', { error: String(error) });
    res.status(500).json({
      success: false,
      error: 'Tor Verification Failed',
      message: getErrorMessage(error, 'Failed to verify Tor connection'),
    });
  }
});

export default router;
