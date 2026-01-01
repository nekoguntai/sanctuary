/**
 * OpenAPI/Swagger Documentation
 *
 * Serves OpenAPI 3.0 specification and Swagger UI for API documentation.
 *
 * ## Endpoints
 *
 * - GET /api/v1/docs - Swagger UI
 * - GET /api/v1/docs/openapi.json - Raw OpenAPI spec
 *
 * ## Usage
 *
 * ```typescript
 * import { setupOpenAPI } from './api/openapi';
 * setupOpenAPI(app);
 * ```
 */

import { Router, Request, Response } from 'express';

const router = Router();

// =============================================================================
// OpenAPI Specification
// =============================================================================

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Sanctuary API',
    description: 'Bitcoin wallet management API for Sanctuary',
    version: '1.0.0',
    contact: {
      name: 'Sanctuary Team',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication and authorization' },
    { name: 'Wallets', description: 'Wallet management' },
    { name: 'Devices', description: 'Hardware device management' },
    { name: 'Transactions', description: 'Transaction operations' },
    { name: 'Drafts', description: 'Transaction drafts (PSBT)' },
    { name: 'Sync', description: 'Wallet synchronization' },
    { name: 'Bitcoin', description: 'Bitcoin network operations' },
    { name: 'Price', description: 'Price information' },
    { name: 'Admin', description: 'Administrative operations' },
  ],
  paths: {
    // =========================================================================
    // Auth Endpoints
    // =========================================================================
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        description: 'Authenticate with username and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' },
              },
            },
          },
          401: {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register',
        description: 'Create a new user account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Registration successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh token',
        description: 'Get a new access token using refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Token refreshed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    refreshToken: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // =========================================================================
    // Wallet Endpoints
    // =========================================================================
    '/wallets': {
      get: {
        tags: ['Wallets'],
        summary: 'List wallets',
        description: 'Get all wallets for the authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'List of wallets',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Wallet' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Wallets'],
        summary: 'Create wallet',
        description: 'Create a new wallet',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateWalletRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Wallet created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Wallet' },
              },
            },
          },
        },
      },
    },
    '/wallets/{walletId}': {
      get: {
        tags: ['Wallets'],
        summary: 'Get wallet',
        description: 'Get a specific wallet by ID',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'walletId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Wallet details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Wallet' },
              },
            },
          },
          404: {
            description: 'Wallet not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
      patch: {
        tags: ['Wallets'],
        summary: 'Update wallet',
        description: 'Update wallet properties',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'walletId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateWalletRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Wallet updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Wallet' },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Wallets'],
        summary: 'Delete wallet',
        description: 'Delete a wallet (owner only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'walletId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Wallet deleted',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuccessResponse' },
              },
            },
          },
        },
      },
    },
    '/wallets/{walletId}/stats': {
      get: {
        tags: ['Wallets'],
        summary: 'Get wallet stats',
        description: 'Get wallet statistics (balance, tx count, etc)',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'walletId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Wallet statistics',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WalletStats' },
              },
            },
          },
        },
      },
    },

    // =========================================================================
    // Device Endpoints
    // =========================================================================
    '/devices': {
      get: {
        tags: ['Devices'],
        summary: 'List devices',
        description: 'Get all devices for the authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'List of devices',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Device' },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Devices'],
        summary: 'Create device',
        description: 'Register a new hardware device',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateDeviceRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Device created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Device' },
              },
            },
          },
        },
      },
    },

    // =========================================================================
    // Sync Endpoints
    // =========================================================================
    '/sync/wallet/{walletId}': {
      post: {
        tags: ['Sync'],
        summary: 'Sync wallet',
        description: 'Synchronize wallet with the blockchain',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'walletId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Sync complete',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SyncResult' },
              },
            },
          },
        },
      },
    },

    // =========================================================================
    // Bitcoin Endpoints
    // =========================================================================
    '/bitcoin/fees': {
      get: {
        tags: ['Bitcoin'],
        summary: 'Get fee estimates',
        description: 'Get current Bitcoin network fee estimates',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Fee estimates',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FeeEstimates' },
              },
            },
          },
        },
      },
    },
    '/bitcoin/broadcast': {
      post: {
        tags: ['Bitcoin'],
        summary: 'Broadcast transaction',
        description: 'Broadcast a signed transaction to the network',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BroadcastRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Transaction broadcast',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BroadcastResponse' },
              },
            },
          },
        },
      },
    },

    // =========================================================================
    // Price Endpoints
    // =========================================================================
    '/price': {
      get: {
        tags: ['Price'],
        summary: 'Get BTC price',
        description: 'Get current Bitcoin price in USD',
        responses: {
          200: {
            description: 'Price data',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Price' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      // =========================================================================
      // Common Schemas
      // =========================================================================
      ApiError: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'NotFound' },
          code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
          message: { type: 'string', example: 'Wallet not found' },
          details: { type: 'object' },
          timestamp: { type: 'string', format: 'date-time' },
          requestId: { type: 'string' },
        },
        required: ['error', 'code', 'message', 'timestamp'],
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
        },
        required: ['success', 'message'],
      },

      // =========================================================================
      // Auth Schemas
      // =========================================================================
      LoginRequest: {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 8 },
        },
        required: ['username', 'password'],
      },
      RegisterRequest: {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 8 },
        },
        required: ['username', 'password'],
      },
      LoginResponse: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          refreshToken: { type: 'string' },
          user: { $ref: '#/components/schemas/User' },
          requires2FA: { type: 'boolean' },
        },
        required: ['token', 'refreshToken', 'user'],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          isAdmin: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          preferences: { type: 'object' },
          has2FA: { type: 'boolean' },
        },
        required: ['id', 'username', 'isAdmin', 'createdAt', 'has2FA'],
      },

      // =========================================================================
      // Wallet Schemas
      // =========================================================================
      Wallet: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['single_sig', 'multi_sig'] },
          scriptType: { type: 'string', enum: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] },
          network: { type: 'string', enum: ['mainnet', 'testnet', 'regtest', 'signet'] },
          quorum: { type: 'integer', nullable: true },
          totalSigners: { type: 'integer', nullable: true },
          descriptor: { type: 'string', nullable: true },
          balance: { type: 'string', description: 'Balance in satoshis as string' },
          unconfirmedBalance: { type: 'string', description: 'Unconfirmed balance in satoshis' },
          lastSynced: { type: 'string', format: 'date-time', nullable: true },
          syncStatus: { type: 'string', enum: ['synced', 'syncing', 'error', 'pending', 'never'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          role: { type: 'string', enum: ['owner', 'signer', 'viewer'] },
          deviceCount: { type: 'integer' },
          isShared: { type: 'boolean' },
          pendingConsolidation: { type: 'boolean' },
          pendingReceive: { type: 'boolean' },
          pendingSend: { type: 'boolean' },
          hasPendingDraft: { type: 'boolean' },
          group: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
        required: ['id', 'name', 'type', 'scriptType', 'network', 'balance', 'createdAt'],
      },
      CreateWalletRequest: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['single_sig', 'multi_sig'] },
          scriptType: { type: 'string', enum: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] },
          network: { type: 'string', enum: ['mainnet', 'testnet', 'regtest', 'signet'] },
          quorum: { type: 'integer' },
          totalSigners: { type: 'integer' },
          descriptor: { type: 'string' },
          fingerprint: { type: 'string' },
          groupId: { type: 'string' },
          deviceIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'type', 'scriptType'],
      },
      UpdateWalletRequest: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          descriptor: { type: 'string' },
        },
      },
      WalletStats: {
        type: 'object',
        properties: {
          balance: { type: 'number' },
          received: { type: 'number' },
          sent: { type: 'number' },
          transactionCount: { type: 'integer' },
          utxoCount: { type: 'integer' },
          addressCount: { type: 'integer' },
        },
        required: ['balance', 'received', 'sent', 'transactionCount', 'utxoCount', 'addressCount'],
      },

      // =========================================================================
      // Device Schemas
      // =========================================================================
      Device: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          fingerprint: { type: 'string' },
          xpub: { type: 'string', nullable: true },
          derivationPath: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          role: { type: 'string', enum: ['owner', 'viewer'] },
          walletCount: { type: 'integer' },
          model: { type: 'string', nullable: true },
          type: { type: 'string', nullable: true },
        },
        required: ['id', 'label', 'fingerprint', 'createdAt', 'role', 'walletCount'],
      },
      CreateDeviceRequest: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          fingerprint: { type: 'string' },
          xpub: { type: 'string' },
          derivationPath: { type: 'string' },
          model: { type: 'string' },
          type: { type: 'string' },
        },
        required: ['label', 'fingerprint'],
      },

      // =========================================================================
      // Sync Schemas
      // =========================================================================
      SyncResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          walletId: { type: 'string' },
          balance: { type: 'string' },
          unconfirmedBalance: { type: 'string' },
          transactionsFound: { type: 'integer' },
          newAddressesGenerated: { type: 'integer' },
          duration: { type: 'number' },
        },
        required: ['success', 'walletId', 'balance'],
      },

      // =========================================================================
      // Bitcoin Schemas
      // =========================================================================
      FeeEstimates: {
        type: 'object',
        properties: {
          fastest: { type: 'number' },
          fast: { type: 'number' },
          medium: { type: 'number' },
          slow: { type: 'number' },
          minimum: { type: 'number' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['fastest', 'fast', 'medium', 'slow', 'minimum', 'updatedAt'],
      },
      BroadcastRequest: {
        type: 'object',
        properties: {
          hex: { type: 'string', description: 'Signed transaction hex' },
          walletId: { type: 'string' },
        },
        required: ['hex', 'walletId'],
      },
      BroadcastResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          txid: { type: 'string' },
        },
        required: ['success', 'txid'],
      },

      // =========================================================================
      // Price Schemas
      // =========================================================================
      Price: {
        type: 'object',
        properties: {
          price: { type: 'number' },
          currency: { type: 'string' },
          change24h: { type: 'number' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['price', 'currency', 'change24h', 'updatedAt'],
      },
    },
  },
};

// =============================================================================
// Swagger UI HTML
// =============================================================================

const swaggerUIHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sanctuary API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/v1/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: 'BaseLayout',
      });
    };
  </script>
</body>
</html>
`;

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /api/v1/docs
 * Swagger UI
 */
router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(swaggerUIHtml);
});

/**
 * GET /api/v1/docs/openapi.json
 * Raw OpenAPI specification
 */
router.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

export default router;
export { openApiSpec };
