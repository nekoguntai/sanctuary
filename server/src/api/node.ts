/**
 * Node API Routes
 *
 * API endpoints for testing connections to Electrum servers
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import net from 'net';
import tls from 'tls';
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
 * POST /api/v1/node/test
 * Test connection to an Electrum server
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { nodeType, host, port, protocol } = req.body;

    log.debug('Testing connection', { nodeType, host, port, protocol });

    // Validate required fields
    if (!host || !port) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required fields: host, port',
      });
    }

    // Only Electrum is supported
    if (nodeType && nodeType !== 'electrum') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Only Electrum connection type is supported',
      });
    }

    // Test Electrum connection
    if (!protocol) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required field: protocol (tcp or ssl)',
      });
    }

    const result = await testElectrumConnection({
      host,
      port: parseInt(port),
      protocol: protocol as 'tcp' | 'ssl',
    });

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
