/**
 * Verification Email Template Tests
 *
 * Tests for email verification template generation.
 */

import { describe, it, expect } from 'vitest';
import { generateVerificationEmail } from '../../../../../src/services/email/templates/verification';

describe('Verification Email Template', () => {
  const defaultData = {
    username: 'testuser',
    email: 'test@example.com',
    verificationUrl: 'http://localhost:3000/verify-email?token=abc123',
    expiresInHours: 24,
    serverName: 'Sanctuary',
  };

  describe('generateVerificationEmail', () => {
    it('should generate all required fields', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('html');
    });

    it('should have correct subject line', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.subject).toBe('Verify your email for Sanctuary');
    });

    it('should include server name in subject', () => {
      const customData = { ...defaultData, serverName: 'My Bitcoin Wallet' };
      const result = generateVerificationEmail(customData);

      expect(result.subject).toBe('Verify your email for My Bitcoin Wallet');
    });

    it('should include username in text content', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.text).toContain('Hello testuser');
    });

    it('should include username in HTML content', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('<strong>testuser</strong>');
    });

    it('should include verification URL in text content', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.text).toContain(defaultData.verificationUrl);
    });

    it('should include verification URL in HTML content as link', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain(`href="${defaultData.verificationUrl}"`);
    });

    it('should include verification URL in HTML content as fallback text', () => {
      const result = generateVerificationEmail(defaultData);

      // URL should appear in the url-fallback section as plain text
      // Escape special regex characters in URL (like ?)
      const escapedUrl = defaultData.verificationUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const urlOccurrences = (result.html.match(new RegExp(escapedUrl, 'g')) || []).length;
      expect(urlOccurrences).toBeGreaterThanOrEqual(2); // At least in href and fallback
    });

    it('should include expiration hours in text content', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.text).toContain('24 hours');
    });

    it('should include expiration hours in HTML content', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('24 hours');
    });

    it('should include server name in text content', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.text).toContain('Sanctuary');
    });

    it('should include server name in HTML content', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('Sanctuary');
    });

    it('should include warning about unsolicited email in text', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.text).toContain('If you did not create an account');
      expect(result.text).toContain('safely ignore this email');
    });

    it('should include warning about unsolicited email in HTML', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('If you did not create an account');
      expect(result.html).toContain('safely ignore this email');
    });

    it('should handle custom expiration hours', () => {
      const customData = { ...defaultData, expiresInHours: 48 };
      const result = generateVerificationEmail(customData);

      expect(result.text).toContain('48 hours');
      expect(result.html).toContain('48 hours');
    });

    it('should handle special characters in username', () => {
      const customData = { ...defaultData, username: 'user<script>alert(1)</script>' };
      const result = generateVerificationEmail(customData);

      // The username appears in the content (it's the caller's responsibility to sanitize)
      expect(result.text).toContain('user<script>alert(1)</script>');
    });

    it('should handle special characters in server name', () => {
      const customData = { ...defaultData, serverName: 'My & Bitcoin "Wallet"' };
      const result = generateVerificationEmail(customData);

      expect(result.subject).toContain('My & Bitcoin "Wallet"');
    });

    it('should generate valid HTML structure', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('<html>');
      expect(result.html).toContain('</html>');
      expect(result.html).toContain('<head>');
      expect(result.html).toContain('</head>');
      expect(result.html).toContain('<body>');
      expect(result.html).toContain('</body>');
    });

    it('should include responsive meta viewport tag', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('viewport');
      expect(result.html).toContain('width=device-width');
    });

    it('should include charset declaration', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('charset="utf-8"');
    });

    it('should include a CTA button', () => {
      const result = generateVerificationEmail(defaultData);

      expect(result.html).toContain('class="button"');
      expect(result.html).toContain('Verify Email');
    });

    it('should not have trailing/leading whitespace in outputs', () => {
      const result = generateVerificationEmail(defaultData);

      // text and html should be trimmed
      expect(result.text).toBe(result.text.trim());
      expect(result.html).toBe(result.html.trim());
    });

    it('should handle very long verification URLs', () => {
      const longToken = 'x'.repeat(500);
      const customData = {
        ...defaultData,
        verificationUrl: `http://localhost:3000/verify-email?token=${longToken}`,
      };
      const result = generateVerificationEmail(customData);

      expect(result.text).toContain(longToken);
      expect(result.html).toContain(longToken);
    });

    it('should handle single-digit expiration hours', () => {
      const customData = { ...defaultData, expiresInHours: 1 };
      const result = generateVerificationEmail(customData);

      expect(result.text).toContain('1 hours'); // Grammar not enforced in template
      expect(result.html).toContain('1 hours');
    });
  });
});
