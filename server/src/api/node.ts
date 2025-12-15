/**
 * Node API Routes
 *
 * API endpoints for testing connections to Bitcoin nodes and Electrum servers
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import net from 'net';
import tls from 'tls';
import axios from 'axios';
import { createLogger } from '../utils/logger';

const router = Router();
const log = createLogger('NODE');

// All routes require authentication
router.use(authenticate);

interface ElectrumTestConfig {
  host: string;
  port: number;
  protocol: 'tcp' | 'ssl';
}

interface BitcoinCoreTestConfig {
  host: string;
  port: number;
  rpcUser: string;
  rpcPassword: string;
  ssl: boolean;
}

/**
 * Test Electrum server connection
 */
async function testElectrumConnection(config: ElectrumTestConfig): Promise<{ success: boolean; message: string; serverInfo?: any }> {
  return new Promise((resolve) => {
    const { host, port, protocol } = config;
    let socket: net.Socket | tls.TLSSocket;
    let buffer = '';
    let resolved = false;

    const cleanup = () => {
      if (socket) {
        socket.destroy();
      }
    };

    const handleSuccess = (message: string, serverInfo?: any) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: true, message, serverInfo });
      }
    };

    const handleError = (message: string) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, message });
      }
    };

    try {
      // Create socket based on protocol
      if (protocol === 'ssl') {
        socket = tls.connect({
          host,
          port,
          rejectUnauthorized: false, // Allow self-signed certs
          timeout: 10000,
        });
      } else {
        socket = net.connect({
          host,
          port,
          timeout: 10000,
        });
      }

      // Connection timeout
      const timeout = setTimeout(() => {
        handleError('Connection timeout (10 seconds)');
      }, 10000);

      socket.on('connect', () => {
        // Send server.version request
        const request = {
          jsonrpc: '2.0',
          method: 'server.version',
          params: ['Sanctuary', '1.4'],
          id: 1,
        };

        socket.write(JSON.stringify(request) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();

        // Try to parse JSON response
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const response = JSON.parse(line);

            if (response.id === 1) {
              clearTimeout(timeout);

              if (response.error) {
                handleError(`Electrum error: ${response.error.message}`);
              } else if (response.result) {
                const serverInfo = {
                  server: response.result[0] || 'Unknown',
                  protocol: response.result[1] || 'Unknown',
                };
                handleSuccess(
                  `Connected to ${serverInfo.server} (protocol ${serverInfo.protocol})`,
                  serverInfo
                );
              } else {
                handleSuccess('Connected successfully');
              }
            }
          } catch (e) {
            // Not valid JSON yet, wait for more data
          }
        }
      });

      socket.on('error', (error: any) => {
        clearTimeout(timeout);
        handleError(`Connection failed: ${error.message}`);
      });

      socket.on('timeout', () => {
        clearTimeout(timeout);
        handleError('Connection timeout');
      });

    } catch (error: any) {
      handleError(`Connection error: ${error.message}`);
    }
  });
}

/**
 * Test Bitcoin Core RPC connection
 */
async function testBitcoinCoreConnection(config: BitcoinCoreTestConfig): Promise<{ success: boolean; message: string; nodeInfo?: any }> {
  const { host, port, rpcUser, rpcPassword, ssl } = config;

  try {
    const protocol = ssl ? 'https' : 'http';
    const url = `${protocol}://${host}:${port}`;

    // Create Basic Auth header
    const auth = Buffer.from(`${rpcUser}:${rpcPassword}`).toString('base64');

    // Call getblockchaininfo
    const response = await axios.post(
      url,
      {
        jsonrpc: '1.0',
        id: 'sanctuary-test',
        method: 'getblockchaininfo',
        params: [],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
        },
        timeout: 10000,
        // Allow self-signed certificates
        httpsAgent: ssl ? new (require('https').Agent)({
          rejectUnauthorized: false
        }) : undefined,
      }
    );

    if (response.data.error) {
      return {
        success: false,
        message: `RPC error: ${response.data.error.message}`,
      };
    }

    const result = response.data.result;
    const nodeInfo = {
      chain: result.chain,
      blocks: result.blocks,
      headers: result.headers,
      verificationProgress: result.verificationprogress,
    };

    return {
      success: true,
      message: `Connected to Bitcoin Core (${result.chain} network, ${result.blocks} blocks)`,
      nodeInfo,
    };
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        message: 'Connection refused. Check if Bitcoin Core is running.',
      };
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return {
        success: false,
        message: 'Connection timeout. Check host and port.',
      };
    } else if (error.response?.status === 401) {
      return {
        success: false,
        message: 'Authentication failed. Check RPC username and password.',
      };
    } else if (error.response?.status === 403) {
      return {
        success: false,
        message: 'Access forbidden. Check rpcallowip in bitcoin.conf.',
      };
    } else {
      return {
        success: false,
        message: `Connection failed: ${error.message}`,
      };
    }
  }
}

/**
 * POST /api/v1/node/test
 * Test connection to a Bitcoin node or Electrum server
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { nodeType, host, port, protocol, rpcUser, rpcPassword, ssl } = req.body;

    log.debug('Testing connection', { nodeType, host, port, protocol, ssl });

    // Validate required fields
    if (!nodeType || !host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required fields: nodeType, host, port',
      });
    }

    let result;

    if (nodeType === 'electrum') {
      // Test Electrum connection
      if (!protocol) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required field for Electrum: protocol',
        });
      }

      result = await testElectrumConnection({
        host,
        port: parseInt(port),
        protocol: protocol as 'tcp' | 'ssl',
      });
    } else if (nodeType === 'bitcoind') {
      // Test Bitcoin Core connection
      if (!rpcUser || !rpcPassword) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required fields for Bitcoin Core: rpcUser, rpcPassword',
        });
      }

      result = await testBitcoinCoreConnection({
        host,
        port: parseInt(port),
        rpcUser,
        rpcPassword,
        ssl: ssl === true || ssl === 'true',
      });
    } else {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid nodeType. Must be "electrum" or "bitcoind"',
      });
    }

    log.debug('Test result', { result });
    res.json(result);
  } catch (error) {
    log.error('Test connection error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to test node connection',
    });
  }
});

export default router;
