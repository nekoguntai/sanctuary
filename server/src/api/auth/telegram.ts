/**
 * Auth - Telegram Router
 *
 * Endpoints for Telegram notification integration setup
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('AUTH:TELEGRAM');

/**
 * POST /api/v1/auth/telegram/chat-id
 * Fetch chat ID from bot's recent messages (user must message the bot first)
 */
router.post('/telegram/chat-id', async (req: Request, res: Response) => {
  try {
    const { botToken } = req.body;

    if (!botToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Bot token is required',
      });
    }

    const { getChatIdFromBot } = await import('../../services/telegram/telegramService');
    const result = await getChatIdFromBot(botToken);

    if (result.success) {
      res.json({
        success: true,
        chatId: result.chatId,
        username: result.username,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to fetch chat ID',
      });
    }
  } catch (error) {
    log.error('Telegram chat-id fetch error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch chat ID',
    });
  }
});

/**
 * POST /api/v1/auth/telegram/test
 * Test Telegram configuration by sending a test message
 */
router.post('/telegram/test', async (req: Request, res: Response) => {
  try {
    const { botToken, chatId } = req.body;

    if (!botToken || !chatId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Bot token and chat ID are required',
      });
    }

    // Import telegram service
    const { testTelegramConfig } = await import('../../services/telegram/telegramService');
    const result = await testTelegramConfig(botToken, chatId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Test message sent successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to send test message',
      });
    }
  } catch (error) {
    log.error('Telegram test error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to test Telegram configuration',
    });
  }
});

export default router;
