/**
 * Device API Path Definitions
 *
 * OpenAPI path definitions for hardware device management endpoints.
 */

const deviceIdParameter = {
  name: 'deviceId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

export const devicePaths = {
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
        200: {
          description: 'Existing device updated by merge request',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DeviceMergeResponse' },
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
        409: {
          description: 'Device fingerprint conflict or account merge conflict',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DeviceConflictResponse' },
            },
          },
        },
      },
    },
  },
  '/devices/{deviceId}': {
    get: {
      tags: ['Devices'],
      summary: 'Get device',
      description: 'Get a specific hardware device by ID',
      security: [{ bearerAuth: [] }],
      parameters: [deviceIdParameter],
      responses: {
        200: {
          description: 'Device details',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Device' },
            },
          },
        },
        404: {
          description: 'Device not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
    patch: {
      tags: ['Devices'],
      summary: 'Update device',
      description: 'Update hardware device properties',
      security: [{ bearerAuth: [] }],
      parameters: [deviceIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateDeviceRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Device updated',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Device' },
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
        404: {
          description: 'Device not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
    delete: {
      tags: ['Devices'],
      summary: 'Delete device',
      description: 'Delete a hardware device if it is not in use by any wallet',
      security: [{ bearerAuth: [] }],
      parameters: [deviceIdParameter],
      responses: {
        204: {
          description: 'Device deleted',
        },
        404: {
          description: 'Device not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
        409: {
          description: 'Device is in use by one or more wallets',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ApiError' },
            },
          },
        },
      },
    },
  },
} as const;
