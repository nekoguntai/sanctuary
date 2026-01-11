/**
 * ThemeProvider Component Tests
 *
 * Tests for the theme management component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ThemeProvider } from '../../components/ThemeProvider';

// Mock the theme registry
vi.mock('../../themes', () => ({
  themeRegistry: {
    applyTheme: vi.fn(),
    applyPattern: vi.fn(),
  },
}));

import { themeRegistry } from '../../themes';

const mockApplyTheme = vi.mocked(themeRegistry.applyTheme);
const mockApplyPattern = vi.mocked(themeRegistry.applyPattern);

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset document classes and styles
    document.documentElement.classList.remove('dark');
    document.body.style.transition = '';
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    document.body.style.transition = '';
  });

  describe('rendering', () => {
    it('should render children', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div data-testid="child">Child content</div>
        </ThemeProvider>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByTestId('child')).toHaveTextContent('Child content');
    });

    it('should render multiple children', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div data-testid="child1">First</div>
          <div data-testid="child2">Second</div>
        </ThemeProvider>
      );

      expect(screen.getByTestId('child1')).toBeInTheDocument();
      expect(screen.getByTestId('child2')).toBeInTheDocument();
    });
  });

  describe('dark mode', () => {
    it('should add dark class when darkMode is true', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={true}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should not add dark class when darkMode is false', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should remove dark class when switching from dark to light', () => {
      const { rerender } = render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={true}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(true);

      rerender(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('theme application', () => {
    it('should apply theme with light mode', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyTheme).toHaveBeenCalledWith('sanctuary', 'light');
    });

    it('should apply theme with dark mode', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={true}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyTheme).toHaveBeenCalledWith('sanctuary', 'dark');
    });

    it('should apply different themes', () => {
      render(
        <ThemeProvider theme="bitcoin" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyTheme).toHaveBeenCalledWith('bitcoin', 'light');
    });
  });

  describe('background pattern', () => {
    it('should apply background pattern', () => {
      render(
        <ThemeProvider theme="sanctuary" background="topography" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyPattern).toHaveBeenCalledWith('topography', 'sanctuary');
    });

    it('should apply none pattern', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyPattern).toHaveBeenCalledWith('none', 'sanctuary');
    });
  });

  describe('transitions', () => {
    it('should set transition style on body', () => {
      render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(document.body.style.transition).toBe('background-color 0.5s ease, color 0.5s ease');
    });
  });

  describe('effect dependencies', () => {
    it('should reapply theme when theme prop changes', () => {
      const { rerender } = render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyTheme).toHaveBeenCalledTimes(1);

      rerender(
        <ThemeProvider theme="bitcoin" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyTheme).toHaveBeenCalledTimes(2);
      expect(mockApplyTheme).toHaveBeenLastCalledWith('bitcoin', 'light');
    });

    it('should reapply pattern when background changes', () => {
      const { rerender } = render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyPattern).toHaveBeenCalledTimes(1);

      rerender(
        <ThemeProvider theme="sanctuary" background="topography" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyPattern).toHaveBeenCalledTimes(2);
    });

    it('should reapply theme when darkMode changes', () => {
      const { rerender } = render(
        <ThemeProvider theme="sanctuary" background="none" darkMode={false}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyTheme).toHaveBeenCalledWith('sanctuary', 'light');

      rerender(
        <ThemeProvider theme="sanctuary" background="none" darkMode={true}>
          <div>Content</div>
        </ThemeProvider>
      );

      expect(mockApplyTheme).toHaveBeenCalledWith('sanctuary', 'dark');
    });
  });
});
