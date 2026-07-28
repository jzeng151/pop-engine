import express from 'express';
import { executeIdempotentTask } from '../services/idempotencyService.js';

const router = express.Router();

router.post('/submit-event', async (req, res) => {
  const { userId, eventData } = req.body;

  try {
    const result = await executeIdempotentTask(userId, eventData, async (normalizedData) => {
      console.log('Processing unique onboarding event:', normalizedData);
      return { eventId: `evt_${Date.now()}`, ...normalizedData };
    });

    if (result.status === 'SUCCESS') {
      return res.status(200).json(result);
    }

    if (result.status === 'COMPLETED') {
      return res.status(200).json({ message: result.message, code: 'DUPLICATE_IGNORED' });
    }

    if (result.status === 'IN_PROGRESS' || result.status === 'TRANSIENT_COLLISION') {
      return res.status(409).json({ message: result.message, code: result.status });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message, code: 'PROCESSING_FAILED' });
  }
});

export default router;
