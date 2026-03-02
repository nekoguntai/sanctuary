import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAISettings } from '../../../../components/AISettings/hooks/useAISettings';
import * as adminApi from '../../../../src/api/admin';
import * as aiApi from '../../../../src/api/ai';

vi.mock('../../../../src/api/admin', () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}));

vi.mock('../../../../src/api/ai', () => ({
  listModels: vi.fn(),
  detectOllama: vi.fn(),
  getOllamaContainerStatus: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useAISettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      aiEnabled: true,
      aiEndpoint: 'http://ollama:11434',
      aiModel: '',
    } as never);
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValue({} as never);
    vi.mocked(aiApi.getOllamaContainerStatus).mockRejectedValue(new Error('offline'));
    vi.mocked(aiApi.listModels).mockResolvedValue({} as never); // covers `result.models || []`
  });

  it('uses model-list fallback and detect fallback message branches', async () => {
    vi.mocked(aiApi.detectOllama)
      .mockResolvedValueOnce({ found: true, endpoint: 'http://detected:11434', models: [] } as never)
      .mockResolvedValueOnce({ found: false } as never); // covers `result.message || fallback`

    const { result } = renderHook(() => useAISettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await waitFor(() => {
      expect(aiApi.listModels).toHaveBeenCalled();
      expect(result.current.availableModels).toEqual([]);
    });

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ aiEndpoint: 'http://detected:11434' });
    expect(result.current.detectMessage).toBe('Found Ollama at http://detected:11434 - saved!');

    await act(async () => {
      await result.current.handleDetectOllama();
    });

    expect(result.current.detectMessage).toBe('Ollama not found. Is it running?');
  });
});
