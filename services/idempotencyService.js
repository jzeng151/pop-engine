import crypto from 'crypto';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

redis.on('error', (err) => {
  console.error('[Redis Error]', err);
});

// Atomic Lua Script: Only release lock if token matches
const RELEASE_LOCK_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

// Atomic Lua Script: Transition from PROCESSING to COMPLETED if token matches
const COMPLETE_EVENT_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("set", KEYS[1], "COMPLETED", "EX", ARGV[2])
  else
    return 0
  end
`;

function normalizePayload(userId, eventData) {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Invalid or missing userId');
  }
  if (!eventData || typeof eventData !== 'object') {
    throw new Error('Invalid eventData payload');
  }
  if (typeof eventData.title !== 'string' || !eventData.title.trim()) {
    throw new Error('Invalid or missing event title');
  }

  const normalizedAmount = Number(eventData.amount || 0);
  const dateStr = String(eventData.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Invalid date: must be in YYYY-MM-DD format');
  }

  return {
    userId: userId.trim(),
    title: eventData.title.trim().toLowerCase(),
    amount: normalizedAmount.toFixed(2),
    date: dateStr,
  };
}

function generateHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function executeIdempotentTask(userId, rawPayload, taskCallback) {
  const normalized = normalizePayload(userId, rawPayload);
  const eventHash = generateHash(normalized);
  
  // Cluster-friendly hash tag {userId}
  const idempotencyKey = `idempotency:{${normalized.userId}}:${eventHash}`;
  const lockToken = `lock:${crypto.randomUUID()}`;

  // 1. Attempt atomic lock acquisition (30-second TTL)
  const acquired = await redis.set(idempotencyKey, lockToken, 'NX', 'EX', 30);

  if (!acquired) {
    const currentState = await redis.get(idempotencyKey);

    if (currentState === null) {
      return {
        status: 'TRANSIENT_COLLISION',
        message: 'Lock is currently held, but state metadata is absent. Retry with backoff.',
      };
    }

    if (currentState === 'COMPLETED') {
      return {
        status: 'COMPLETED',
        message: 'Event has already been successfully processed.',
      };
    }

    return {
      status: 'IN_PROGRESS',
      message: 'Event submission is actively processing by another worker.',
    };
  }

  try {
    // 2. Perform business logic
    const result = await taskCallback(normalized);

    // 3. Mark completed atomically (24-hour TTL)
    const completed = await redis.eval(COMPLETE_EVENT_LUA, 1, idempotencyKey, lockToken, 86400);
    if (!completed) {
      console.warn(`[Lock Steal Warning] Execution exceeded 30s TTL for key: ${idempotencyKey}`);
    }

    return {
      status: 'SUCCESS',
      data: result,
    };
  } catch (err) {
    // 4. Cleanup lock on failure
    try {
      await redis.eval(RELEASE_LOCK_LUA, 1, idempotencyKey, lockToken);
    } catch (cleanupErr) {
      console.error(`[Cleanup Error] Failed to release key ${idempotencyKey}:`, cleanupErr);
    }

    throw err;
  }
}
