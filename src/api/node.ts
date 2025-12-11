/**
 * Node API
 *
 * API calls for testing Bitcoin node and Electrum server connections
 */

import apiClient from './client';

export interface NodeTestRequest {
  nodeType: 'electrum' | 'bitcoind';
  host: string;
  port: string;
  protocol?: 'tcp' | 'ssl';
  rpcUser?: string;
  rpcPassword?: string;
  ssl?: boolean;
}

export interface NodeTestResponse {
  success: boolean;
  message: string;
  serverInfo?: {
    server?: string;
    protocol?: string;
  };
  nodeInfo?: {
    chain?: string;
    blocks?: number;
    headers?: number;
    verificationProgress?: number;
  };
}

/**
 * Test connection to a Bitcoin node or Electrum server
 */
export async function testNodeConnection(config: NodeTestRequest): Promise<NodeTestResponse> {
  return apiClient.post<NodeTestResponse>('/node/test', config);
}
