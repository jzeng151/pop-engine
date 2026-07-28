import express from 'express';
import { discoverNycParkSpaces, validateNycInsuranceRequirements } from '../services/nycParksService.js';
import { submitNycParksPermitAgent } from '../services/permitAgentService.js';
import { generateInspectorBinder, verifyVaultHash } from '../services/receiptsVaultService.js';

const router = express.Router();

// 1. Discover Parks by Borough
router.get('/nyc/discover', async (req, res) => {
  const { borough } = req.query;
  if (!borough) {
    return res.status(400).json({ error: 'Borough parameter is required (e.g., M, B, Q, X, R)' });
  }

  try {
    const spaces = await discoverNycParkSpaces(borough);
    return res.status(200).json({ status: 'SUCCESS', spaces });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Validate Event Parameters & Insurance Checklist
router.post('/nyc/evaluate-compliance', async (req, res) => {
  const { expectedAttendance, leadTimeDays, insurance } = req.body;

  const complianceRules = {
    requiresSpecialEventPermit: expectedAttendance > 20,
    leadTimeCompliant: leadTimeDays >= 21,
    leadTimeWarning: leadTimeDays < 30 ? 'NYC Parks recommends 30+ days for guaranteed processing.' : null,
  };

  let insuranceValidation = null;
  if (insurance) {
    insuranceValidation = validateNycInsuranceRequirements(
      insurance.perOccurrence,
      insurance.aggregate,
      insurance.cityNamedAdditionalInsured
    );
  }

  return res.status(200).json({
    status: 'EVALUATED',
    rules: complianceRules,
    insuranceValidation,
  });
});

// 3. Autonomous Permit Submission Endpoint (Playwright Agent)
router.post('/nyc/submit-autonomous', async (req, res) => {
  const { userEmail, userPassword, eventData } = req.body;

  if (!userEmail || !userPassword || !eventData) {
    return res.status(400).json({ error: 'Missing required credentials or event metadata.' });
  }

  try {
    const agentResult = await submitNycParksPermitAgent({
      userEmail,
      userPassword,
      eventData,
    });

    return res.status(200).json({
      message: 'Agent successfully completed municipal submission without leaving PopEngine.',
      referenceId: agentResult.referenceId,
      portal: 'NYC Parks E-Apply',
      timestamp: agentResult.submittedAt,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. Generate Lock-Screen Inspector Binder (Receipts Vault)
router.post('/nyc/inspector-vault', async (req, res) => {
  const { userId, userEmail, eventData, permits } = req.body;

  if (!eventData || !eventData.eventId) {
    return res.status(400).json({ error: 'Missing required event metadata.' });
  }

  try {
    const binderPayload = {
      owner: { userId, userEmail },
      ...eventData
    };

    const binder = generateInspectorBinder(binderPayload, permits);
    return res.status(200).json({ status: 'SUCCESS', binder });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 5. Verify Cryptographic SHA-256 Non-Repudiation Proof On-Site
router.post('/nyc/verify-vault', async (req, res) => {
  const { rawData, hashToVerify } = req.body;

  if (!rawData || !hashToVerify) {
    return res.status(400).json({ error: 'Missing rawData or hashToVerify parameters.' });
  }

  try {
    const isValid = verifyVaultHash(rawData, hashToVerify);
    return res.status(200).json({
      verified: isValid,
      message: isValid ? 'Cryptographic timestamp and payload verified.' : 'Hash mismatch! File may be altered.'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 6. Real-Time Permit Progress & Stage Tracker
router.get('/status/:permitId', async (req, res) => {
  const { permitId } = req.params;

  const permitProgress = {
    permitId,
    eventId: 'POP_NYC_01',
    currentStage: 'SUBMITTED', // DRAFT | EVALUATED | SUBMITTED | UNDER_REVIEW | APPROVED_VAULTED
    progressPercent: 60,
    history: [
      { stage: 'DRAFT', completed: true },
      { stage: 'EVALUATED', completed: true },
      { stage: 'SUBMITTED', completed: true },
      { stage: 'UNDER_REVIEW', completed: false },
      { stage: 'APPROVED_VAULTED', completed: false }
    ]
  };

  return res.status(200).json({ success: true, progress: permitProgress });
});

export default router;
