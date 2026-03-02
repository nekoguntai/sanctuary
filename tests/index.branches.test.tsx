import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('index bootstrap branch coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('initializes themes and mounts app when root element exists', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    const initializeThemes = vi.fn();
    const render = vi.fn();
    const createRoot = vi.fn(() => ({ render }));

    vi.doMock('../themes', () => ({
      initializeThemes,
    }));
    vi.doMock('../App', () => ({
      default: () => <div>Mock App</div>,
    }));
    vi.doMock('react-dom/client', () => ({
      default: { createRoot },
      createRoot,
    }));

    await import('../index');

    expect(initializeThemes).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('throws clear error when root element is missing', async () => {
    const initializeThemes = vi.fn();
    const createRoot = vi.fn();

    vi.doMock('../themes', () => ({
      initializeThemes,
    }));
    vi.doMock('../App', () => ({
      default: () => <div>Mock App</div>,
    }));
    vi.doMock('react-dom/client', () => ({
      default: { createRoot },
      createRoot,
    }));

    let thrown: unknown;
    try {
      await import('../index');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not find root element to mount to');

    expect(initializeThemes).toHaveBeenCalledTimes(1);
    expect(createRoot).not.toHaveBeenCalled();
  });
});
