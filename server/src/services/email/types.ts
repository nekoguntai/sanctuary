/**
 * Email Service Types
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface VerificationEmailData {
  username: string;
  email: string;
  verificationUrl: string;
  expiresInHours: number;
  serverName: string;
}
