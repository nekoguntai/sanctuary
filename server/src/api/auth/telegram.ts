/**
 * Auth - Telegram Router
 *
 * Endpoints for Telegram notification integration setup
 */

import { Router } from 'express';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import { getChatIdFromBot, testTelegramConfig } from '../../services/telegram/telegramService';
import { validate } from '../../middleware/validate';
import { TelegramChatIdSchema, TelegramTestSchema } from '../schemas/auth';

const router = Router();

/**
 * POST /api/v1/auth/telegram/chat-id
 * Fetch chat ID from bot's recent messages (user must message the bot first)
 */
router.post(
  '/telegram/chat-id',
  validate({ body: TelegramChatIdSchema }, { message: 'Bot token is required' }),
  asyncHandler(async (req, res) => {
    const { botToken } = req.body;

    const result = await getChatIdFromBot(botToken);

    if (result.success) {
      res.json({
        success: true,
        chatId: result.chatId,
        username: result.username,
      });
    } else {
      throw new InvalidInputError(result.error || 'Failed to fetch chat ID');
    }
  })
);

/**
 * POST /api/v1/auth/telegram/test
 * Test Telegram configuration by sending a test message
 */
router.post(
  '/telegram/test',
  validate({ body: TelegramTestSchema }, { message: 'Bot token and chat ID are required' }),
  asyncHandler(async (req, res) => {
    const { botToken, chatId } = req.body;

    const result = await testTelegramConfig(botToken, chatId);

    if (result.success) {
      res.json({
        success: true,
        message: 'Test message sent successfully',
      });
    } else {
      throw new InvalidInputError(result.error || 'Failed to send test message');
    }
  })
);

export default router;
