import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// Simulated Redis / In-Memory Live Sync
let liveCheckInCount = 1402; 

router.post('/guest-checkin', async (req, res) => {
  try {
    const { name, contact, eventId = 'POP_NYC_01', zone = 'LOUNGE_01' } = req.body;

    if (!name || !contact) {
      return res.status(400).json({ error: 'Name and contact (Email/SMS) are required.' });
    }

    liveCheckInCount += 1;

    const passHash = crypto
      .createHash('sha256')
      .update(`${name}:${contact}:${Date.now()}`)
      .digest('hex')
      .substring(0, 8)
      .toUpperCase();

    const guestPass = {
      passId: `POP-${passHash}`,
      name,
      contact,
      eventId,
      zone,
      timestamp: new Date().toISOString(),
      status: 'VERIFIED'
    };

    console.log(`[CHECK-IN] New guest registered: ${name} (${passHash}) | Total: ${liveCheckInCount}`);

    return res.status(201).json({
      success: true,
      message: 'Check-in successful',
      guestPass,
      liveCount: liveCheckInCount
    });
  } catch (error) {
    console.error('Check-in error:', error);
    return res.status(500).json({ error: 'Internal server error during check-in.' });
  }
});

export default router;
