// F-203 provider boundary; scheduling stays in alerts.ts.

/** Mirrors the `alerts.channel` CHECK in migration 001. */
export const ALERT_CHANNELS = ["email", "sms"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export type AlertMessage = {
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  /** The row's `idempotency_key`, handed to the provider rather than only stored. */
  readonly idempotencyKey: string;
};

/** Recorded delivery outcome, including whether the send was simulated. */
export type AlertDelivery = {
  readonly simulated: boolean;
  /** Shown in-product when the send was simulated; null for a live one. */
  readonly label: string | null;
  readonly provider: string;
};

/** A failed delivery remains eligible for a later tick. */
export class AlertDeliveryError extends Error {
  /** True when the provider reported an outcome; false when it may have accepted silently. */
  readonly outcomeObserved: boolean;

  constructor(message: string, options: { readonly outcomeObserved?: boolean } = {}) {
    super(message);
    this.name = "AlertDeliveryError";
    this.outcomeObserved = options.outcomeObserved ?? true;
  }
}

export type AlertSender = ((message: AlertMessage) => Promise<AlertDelivery>) & {
  /** False only for local simulations or failures before any provider handoff. */
  readonly reachesAProvider?: boolean;
};

export type AlertSenders = Readonly<Record<AlertChannel, AlertSender>>;

/** Prevents one provider outage from stalling the due-alert queue. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** Failures proven to occur before the first request byte. */
const PROVEN_BEFORE_HANDOFF = new Set([
  // Name resolution or connection establishment failed before a socket existed.
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  // Undici connection failures occur before a socket or proxy tunnel is usable.
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_PRX_TLS",
  // TLS verification completes before HTTP bytes are written.
  "ERR_TLS_CERT_ALTNAME_INVALID",
  // Node's complete named X509 verification table; UNSPECIFIED is excluded because it proves no phase.
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_CRL",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "CERT_SIGNATURE_FAILURE",
  "CRL_SIGNATURE_FAILURE",
  "CERT_NOT_YET_VALID",
  "CERT_HAS_EXPIRED",
  "CRL_NOT_YET_VALID",
  "CRL_HAS_EXPIRED",
  "ERROR_IN_CERT_NOT_BEFORE_FIELD",
  "ERROR_IN_CERT_NOT_AFTER_FIELD",
  "ERROR_IN_CRL_LAST_UPDATE_FIELD",
  "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
  "OUT_OF_MEM",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_CHAIN_TOO_LONG",
  "CERT_REVOKED",
  "INVALID_CA",
  "PATH_LENGTH_EXCEEDED",
  "INVALID_PURPOSE",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "HOSTNAME_MISMATCH",
]);

/** Safe only when an AggregateError proves they occurred during connection setup. */
const PROVEN_INSIDE_A_CONNECT_ATTEMPT = new Set(["ETIMEDOUT"]);

/** `fetch` wraps a transport failure, so the errno naming it sits on the cause chain. */
function failedBeforeHandoff(error: unknown, insideAConnectAttempt = false): boolean {
  for (let link: unknown = error; link instanceof Error; link = link.cause) {
    // Every dual-stack attempt must prove pre-handoff failure; ETIMEDOUT is safe only in this context.
    if (link instanceof AggregateError) {
      return (
        link.errors.length > 0 && link.errors.every((cause) => failedBeforeHandoff(cause, true))
      );
    }
    const { code } = link as { code?: unknown };
    if (typeof code !== "string") continue;
    if (PROVEN_BEFORE_HANDOFF.has(code)) return true;
    if (insideAConnectAttempt && PROVEN_INSIDE_A_CONNECT_ATTEMPT.has(code)) return true;
  }
  return false;
}

/** Email via Resend's HTTP API (BASELINE.md provider baseline; live in the demo). */
export function createResendEmailSender(settings: {
  readonly apiKey: string;
  readonly from: string;
  /** Injected in tests; the real one is the global. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): AlertSender {
  const send = settings.fetch ?? globalThis.fetch;
  const timeoutMs = settings.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  return async (message) => {
    let response: Response;
    try {
      response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${settings.apiKey}`,
          "content-type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: settings.from,
          to: [message.recipient],
          subject: message.subject,
          text: message.body,
        }),
        // Bound the connection and request so a half-open socket reaches the retry path.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Preserve timeout context for operators while routing all transport failures to retry.
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new AlertDeliveryError(
        timedOut
          ? `email provider did not respond within ${timeoutMs}ms`
          : `email provider unreachable: ${error instanceof Error ? error.message : "unknown error"}`,
        // Timeouts and post-write disconnects do not prove that handoff failed.
        { outcomeObserved: failedBeforeHandoff(error) },
      );
    }
    // Release the socket without reading contact data; cleanup cannot override the provider outcome.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      throw new AlertDeliveryError(
        `email provider rejected the send with status ${response.status}`,
        { outcomeObserved: true },
      );
    }
    return { simulated: false, label: null, provider: "resend" };
  };
}

/** Missing email credentials fail visibly and leave the alert pending. */
export const UNCONFIGURED_EMAIL_ERROR =
  "RESEND_API_KEY and SMTP_FROM are not configured; email alerts stay pending until they are";

export function unconfiguredEmailSender(): AlertSender {
  const send: AlertSender = async () => {
    throw new AlertDeliveryError(UNCONFIGURED_EMAIL_ERROR);
  };
  // No provider can hold this message, so an interrupted intent remains safe to retry.
  return Object.assign(send, { reachesAProvider: false });
}

/** Persisted label for simulated SMS delivery. */
export const SIMULATED_SMS_LABEL =
  "SIMULATED SMS — not delivered. Twilio A2P 10DLC registration is still pending " +
  "(docs/BASELINE.md provider baseline; OPEN-QUESTIONS T-1), so SMS renders in-product rather " +
  "than sending.";

/** Simulates SMS until BASELINE records A2P 10DLC approval; the persisted label prevents ambiguity. */
export function createSimulatedSmsSender(record?: (message: AlertMessage) => void): AlertSender {
  const send: AlertSender = async (message) => {
    record?.(message);
    return { simulated: true, label: SIMULATED_SMS_LABEL, provider: "simulated" };
  };
  return Object.assign(send, { reachesAProvider: false });
}

/** Email is live when configured; SMS remains the approved labeled simulation. */
export function sendersFromEnv(environment: NodeJS.ProcessEnv): AlertSenders {
  const apiKey = environment.RESEND_API_KEY ?? "";
  const from = environment.SMTP_FROM ?? "";
  return {
    email:
      apiKey === "" || from === ""
        ? unconfiguredEmailSender()
        : createResendEmailSender({ apiKey, from }),
    sms: createSimulatedSmsSender(),
  };
}
