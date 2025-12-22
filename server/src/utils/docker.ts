/**
 * Docker Container Management
 *
 * Secure interface for managing the Ollama container via Docker socket proxy.
 * Supports dynamic container names via COMPOSE_PROJECT_NAME for multi-instance deployments.
 */

import { createLogger } from './logger';

const log = createLogger('DOCKER');

// Docker proxy URL (set via environment variable)
const DOCKER_PROXY_URL = process.env.DOCKER_PROXY_URL || 'http://docker-proxy:2375';

// Pattern to match ollama containers (supports dynamic project names)
// Container names will be like: {project}-ollama-1
const OLLAMA_CONTAINER_PATTERN = /-ollama-\d+$/;

interface ContainerInfo {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
}

interface ContainerInspect {
  State: {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    Dead: boolean;
    StartedAt: string;
  };
}

/**
 * Find ollama container by pattern
 * Returns the container info if found
 */
async function findOllamaContainer(): Promise<ContainerInfo | null> {
  try {
    const response = await fetch(`${DOCKER_PROXY_URL}/containers/json?all=true`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      log.warn('Failed to list containers', { status: response.status });
      return null;
    }

    const containers = (await response.json()) as ContainerInfo[];
    // Find container matching the ollama pattern (e.g., sanctuary-ollama-1)
    const ollama = containers.find((c) =>
      c.Names.some((name) => OLLAMA_CONTAINER_PATTERN.test(name))
    );

    return ollama || null;
  } catch (error) {
    log.error('Error finding Ollama container', { error });
    return null;
  }
}

/**
 * Get Ollama container status
 */
export async function getOllamaStatus(): Promise<{
  exists: boolean;
  running: boolean;
  status: string;
  containerId?: string;
}> {
  try {
    const ollama = await findOllamaContainer();

    if (!ollama) {
      return { exists: false, running: false, status: 'not_created' };
    }

    return {
      exists: true,
      running: ollama.State === 'running',
      status: ollama.State,
      containerId: ollama.Id,
    };
  } catch (error) {
    log.error('Error getting Ollama status', { error });
    return { exists: false, running: false, status: 'error' };
  }
}

/**
 * Start the Ollama container
 */
export async function startOllama(): Promise<{ success: boolean; message: string }> {
  try {
    const status = await getOllamaStatus();

    if (!status.exists || !status.containerId) {
      return {
        success: false,
        message: 'Ollama container not found. Run "./start.sh --with-ai" first to create it.',
      };
    }

    if (status.running) {
      return { success: true, message: 'Ollama is already running' };
    }

    // Start the container using its ID
    const response = await fetch(
      `${DOCKER_PROXY_URL}/containers/${status.containerId}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.status === 204 || response.status === 304) {
      log.info('Ollama container started');
      return { success: true, message: 'Ollama started successfully' };
    }

    const errorText = await response.text();
    log.warn('Failed to start Ollama', { status: response.status, error: errorText });
    return { success: false, message: `Failed to start Ollama: ${errorText}` };
  } catch (error: any) {
    log.error('Error starting Ollama', { error });
    return { success: false, message: error.message || 'Failed to start Ollama' };
  }
}

/**
 * Stop the Ollama container
 */
export async function stopOllama(): Promise<{ success: boolean; message: string }> {
  try {
    const status = await getOllamaStatus();

    if (!status.exists || !status.containerId) {
      return { success: true, message: 'Ollama container does not exist' };
    }

    if (!status.running) {
      return { success: true, message: 'Ollama is already stopped' };
    }

    // Stop the container using its ID (with 10 second timeout)
    const response = await fetch(
      `${DOCKER_PROXY_URL}/containers/${status.containerId}/stop?t=10`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (response.status === 204 || response.status === 304) {
      log.info('Ollama container stopped');
      return { success: true, message: 'Ollama stopped successfully' };
    }

    const errorText = await response.text();
    log.warn('Failed to stop Ollama', { status: response.status, error: errorText });
    return { success: false, message: `Failed to stop Ollama: ${errorText}` };
  } catch (error: any) {
    log.error('Error stopping Ollama', { error });
    return { success: false, message: error.message || 'Failed to stop Ollama' };
  }
}

/**
 * Check if Docker proxy is available
 */
export async function isDockerProxyAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${DOCKER_PROXY_URL}/containers/json?limit=1`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
