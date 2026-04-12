/**
 * Admin API Path Definitions
 *
 * OpenAPI path definitions for bounded administrative metadata and
 * configuration endpoints.
 */

import { FEATURE_FLAG_KEYS } from '../../../services/featureFlags/definitions';
import { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_STATS_DAYS } from '../../../constants';

const bearerAuth = [{ bearerAuth: [] }] as const;
const AUDIT_LOG_LIMIT_MAX = 500;

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const adminFeatureKeyParameter = {
  name: 'key',
  in: 'path',
  required: true,
  schema: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
} as const;

const adminUserIdParameter = {
  name: 'userId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const jsonRequestBody = (schemaRef: string) => ({
  required: true,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const featureFlagResponse = jsonResponse('Feature flag', '#/components/schemas/AdminFeatureFlag');

export const adminPaths = {
  '/admin/version': {
    get: {
      tags: ['Admin'],
      summary: 'Get application version',
      description: 'Get the current application version and latest GitHub release metadata.',
      responses: {
        200: jsonResponse('Application version information', '#/components/schemas/AdminVersionResponse'),
        500: apiErrorResponse,
      },
    },
  },
  '/admin/settings': {
    get: {
      tags: ['Admin'],
      summary: 'Get system settings',
      description: 'Get administrative system settings. SMTP password values are never returned.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('System settings', '#/components/schemas/AdminSettings'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    put: {
      tags: ['Admin'],
      summary: 'Update system settings',
      description: 'Update administrative system settings. SMTP password values are encrypted before storage and never returned.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminSettingsUpdateRequest'),
      responses: {
        200: jsonResponse('Updated system settings', '#/components/schemas/AdminSettings'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List users',
      description: 'List user account summaries for administrative management.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'User account summaries',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/AdminUser' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create user',
      description: 'Create a trusted user account with an auto-verified email address.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminCreateUserRequest'),
      responses: {
        201: jsonResponse('Created user', '#/components/schemas/AdminUser'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/users/{userId}': {
    put: {
      tags: ['Admin'],
      summary: 'Update user',
      description: 'Update user account fields, admin status, email verification state, or password.',
      security: bearerAuth,
      parameters: [adminUserIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateUserRequest'),
      responses: {
        200: jsonResponse('Updated user', '#/components/schemas/AdminUser'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete user',
      description: 'Delete a user account. The current admin cannot delete their own account.',
      security: bearerAuth,
      parameters: [adminUserIdParameter],
      responses: {
        200: jsonResponse('User deleted', '#/components/schemas/AdminDeleteUserResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features': {
    get: {
      tags: ['Admin'],
      summary: 'List feature flags',
      description: 'List runtime feature flag state from environment and database overrides.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Feature flags',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/AdminFeatureFlag' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/audit-logs': {
    get: {
      tags: ['Admin'],
      summary: 'List audit logs',
      description: 'List administrative audit logs with filters and clamped pagination.',
      security: bearerAuth,
      parameters: [
        {
          name: 'userId',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'username',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'action',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'category',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'success',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'startDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'endDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: AUDIT_LOG_LIMIT_MAX,
            default: AUDIT_DEFAULT_PAGE_SIZE,
          },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Audit log entries', '#/components/schemas/AdminAuditLogsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/audit-logs/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Get audit log statistics',
      description: 'Get aggregate audit log statistics for a recent day window.',
      security: bearerAuth,
      parameters: [
        {
          name: 'days',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, default: AUDIT_STATS_DAYS },
        },
      ],
      responses: {
        200: jsonResponse('Audit log statistics', '#/components/schemas/AdminAuditStatsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/audit-log': {
    get: {
      tags: ['Admin'],
      summary: 'Get feature flag audit log',
      description: 'Get paginated feature flag audit entries, optionally filtered by feature flag key.',
      security: bearerAuth,
      parameters: [
        {
          name: 'key',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...FEATURE_FLAG_KEYS] },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Feature flag audit entries', '#/components/schemas/AdminFeatureFlagAuditResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/{key}': {
    get: {
      tags: ['Admin'],
      summary: 'Get feature flag',
      description: 'Get a single runtime feature flag by key.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update feature flag',
      description: 'Set a database override for a runtime feature flag.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateFeatureFlagRequest'),
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/{key}/reset': {
    post: {
      tags: ['Admin'],
      summary: 'Reset feature flag',
      description: 'Remove a database override and reset a runtime feature flag to its environment default.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
