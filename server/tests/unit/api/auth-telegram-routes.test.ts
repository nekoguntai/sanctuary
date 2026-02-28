import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const {
  mockGetChatIdFromBot,
  mockTestTelegramConfig,
} = vi.hoisted(() => ({
  mockGetChatIdFromBot: vi.fn(),
  mockTestTelegramConfig: vi.fn(),
}));

vi.mock('../../../src/services/telegram/telegramService', () => ({
  getChatIdFromBot: mockGetChatIdFromBot,
  testTelegramConfig: mockTestTelegramConfig,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import telegramAuthRouter from '../../../src/api/auth/telegram';

describe('Auth Telegram Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', telegramAuthRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetChatIdFromBot.mockResolvedValue({
      success: true,
      chatId: '123456789',
      username: 'alice_telegram',
    });

    mockTestTelegramConfig.mockResolvedValue({ success: true });
  });

  it('returns 400 when bot token is missing for chat-id lookup', async () => {
    const response = await request(app)
      .post('/api/v1/auth/telegram/chat-id')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Bot token is required');
  });

  it('returns chat-id and username on successful lookup', async () => {
    const response = await request(app)
      .post('/api/v1/auth/telegram/chat-id')
      .send({ botToken: 'token-123' });

    expect(response.status).toBe(200);
    expect(mockGetChatIdFromBot).toHaveBeenCalledWith('token-123');
    expect(response.body).toEqual({
      success: true,
      chatId: '123456789',
      username: 'alice_telegram',
    });
  });

  it('returns service-provided or default errors for failed chat-id lookup', async () => {
    mockGetChatIdFromBot.mockResolvedValueOnce({ success: false, error: 'No recent messages found' });

    const withCustomError = await request(app)
      .post('/api/v1/auth/telegram/chat-id')
      .send({ botToken: 'token-123' });

    expect(withCustomError.status).toBe(400);
    expect(withCustomError.body).toEqual({ success: false, error: 'No recent messages found' });

    mockGetChatIdFromBot.mockResolvedValueOnce({ success: false });
    const withDefaultError = await request(app)
      .post('/api/v1/auth/telegram/chat-id')
      .send({ botToken: 'token-123' });

    expect(withDefaultError.status).toBe(400);
    expect(withDefaultError.body).toEqual({ success: false, error: 'Failed to fetch chat ID' });
  });

  it('handles unexpected chat-id lookup errors', async () => {
    mockGetChatIdFromBot.mockRejectedValue(new Error('telegram api unavailable'));

    const response = await request(app)
      .post('/api/v1/auth/telegram/chat-id')
      .send({ botToken: 'token-123' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'Failed to fetch chat ID',
    });
  });

  it('returns 400 when required telegram test fields are missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/telegram/test')
      .send({ botToken: 'token-only' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Bot token and chat ID are required');
  });

  it('sends telegram test message successfully', async () => {
    const response = await request(app)
      .post('/api/v1/auth/telegram/test')
      .send({ botToken: 'token-123', chatId: '123456789' });

    expect(response.status).toBe(200);
    expect(mockTestTelegramConfig).toHaveBeenCalledWith('token-123', '123456789');
    expect(response.body).toEqual({
      success: true,
      message: 'Test message sent successfully',
    });
  });

  it('returns service-provided or default telegram test failures', async () => {
    mockTestTelegramConfig.mockResolvedValueOnce({ success: false, error: 'Bot blocked by user' });

    const withCustomError = await request(app)
      .post('/api/v1/auth/telegram/test')
      .send({ botToken: 'token-123', chatId: '123456789' });

    expect(withCustomError.status).toBe(400);
    expect(withCustomError.body).toEqual({ success: false, error: 'Bot blocked by user' });

    mockTestTelegramConfig.mockResolvedValueOnce({ success: false });
    const withDefaultError = await request(app)
      .post('/api/v1/auth/telegram/test')
      .send({ botToken: 'token-123', chatId: '123456789' });

    expect(withDefaultError.status).toBe(400);
    expect(withDefaultError.body).toEqual({ success: false, error: 'Failed to send test message' });
  });

  it('handles unexpected telegram test errors', async () => {
    mockTestTelegramConfig.mockRejectedValue(new Error('network timeout'));

    const response = await request(app)
      .post('/api/v1/auth/telegram/test')
      .send({ botToken: 'token-123', chatId: '123456789' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'Failed to test Telegram configuration',
    });
  });
});
