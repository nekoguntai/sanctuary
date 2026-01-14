/**
 * Email Verification Template
 */

import type { VerificationEmailData } from '../types';

export function generateVerificationEmail(data: VerificationEmailData): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Verify your email for ${data.serverName}`;

  const text = `
Hello ${data.username},

Please verify your email address by clicking the link below:

${data.verificationUrl}

This link will expire in ${data.expiresInHours} hours.

If you did not create an account on ${data.serverName}, you can safely ignore this email.

Best regards,
${data.serverName}
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .container {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 30px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #2c3e50;
      margin: 0;
      font-size: 24px;
    }
    .content {
      background: white;
      border-radius: 6px;
      padding: 25px;
      margin-bottom: 20px;
    }
    .button {
      display: inline-block;
      background: #3498db;
      color: white !important;
      text-decoration: none;
      padding: 12px 30px;
      border-radius: 6px;
      font-weight: 500;
      margin: 20px 0;
    }
    .button:hover {
      background: #2980b9;
    }
    .text-center {
      text-align: center;
    }
    .expires {
      color: #666;
      font-size: 14px;
    }
    .footer {
      text-align: center;
      color: #888;
      font-size: 12px;
      margin-top: 20px;
    }
    .url-fallback {
      word-break: break-all;
      font-size: 12px;
      color: #666;
      margin-top: 20px;
      padding: 10px;
      background: #f5f5f5;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${data.serverName}</h1>
    </div>
    <div class="content">
      <p>Hello <strong>${data.username}</strong>,</p>
      <p>Please verify your email address by clicking the button below:</p>
      <div class="text-center">
        <a href="${data.verificationUrl}" class="button">Verify Email Address</a>
      </div>
      <p class="expires">This link will expire in ${data.expiresInHours} hours.</p>
      <div class="url-fallback">
        <strong>Can't click the button?</strong> Copy and paste this URL into your browser:<br>
        ${data.verificationUrl}
      </div>
    </div>
    <div class="footer">
      <p>If you did not create an account on ${data.serverName}, you can safely ignore this email.</p>
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}
