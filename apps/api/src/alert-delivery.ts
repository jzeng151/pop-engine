// F-203 delivery channels. The poller in `alerts.ts` decides WHAT is due; this file is the only
// place that talks to a provider, so the scheduling logic stays testable without a network and a
// provider swap touches one file (ARCHITECTURE: Twilio for SMS, Resend for email per BASELINE.md).

/** Mirrors the `alerts.channel` CHECK in migration 001. */
export const ALERT_CHANNELS = ["email", "sms"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export type AlertMessage = {
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  /**
   * The row's `idempotency_key`, handed to the provider rather than only stored.
   *
   * This is what makes AC 2's crash requirement hold. The poller marks an alert sent in the same
   * transaction it sends from, so a crash in between rolls the mark back and the next tick tries
   * the same row again — correct for a send that never left, a double-send for one that did.
   * Nothing on this side can tell those apart, so the decision is deferred to the party that can:
   * the provider sees the same key twice and delivers once (AD-13).
   */
  readonly idempotencyKey: string;
};

/**
 * What actually happened, recorded onto the alert row so a reader can tell a live send from a
 * labeled simulation without inferring it from configuration it cannot see.
 */
export type AlertDelivery = {
  readonly simulated: boolean;
  /** Shown in-product when the send was simulated; null for a live one. */
  readonly label: string | null;
  readonly provider: string;
};

/** A delivery that did not happen. The alert stays for a later tick; nothing is lost. */
export class AlertDeliveryError extends Error {
  /**
   * Whether the provider actually told us what it did with the message.
   *
   * A refusal is an answer: the provider said what it did. A connection that was never established
   * is as good as one, because nothing was handed over. Anything in between (a timeout, a socket
   * that died mid-request) is not: the provider may have accepted the message and simply not said
   * so. That distinction is what `alerts.ts` needs to decide whether a retry past the provider's
   * dedup window would be a second delivery or a first one, so it is recorded rather than inferred
   * from the message text.
   *
   * True by default: every throw site that knows nothing was delivered leaves it alone, and the
   * transport path below, which is the one that cannot always tell, says so explicitly.
   */
  readonly outcomeObserved: boolean;

  constructor(message: string, options: { readonly outcomeObserved?: boolean } = {}) {
    super(message);
    this.name = "AlertDeliveryError";
    this.outcomeObserved = options.outcomeObserved ?? true;
  }
}

export type AlertSender = ((message: AlertMessage) => Promise<AlertDelivery>) & {
  /**
   * Whether this sender hands the message to a party outside this process.
   *
   * Read by `alerts.ts` to decide whether an attempt is worth recording at all. The record exists
   * for one question — did a provider end up holding a message nobody here saw the outcome of —
   * and a sender that reaches no provider can never produce that state, so recording an intent for
   * one can only ever manufacture a hold on a message nothing sent.
   *
   * Absent means it does reach one, which is the conservative reading: an unmarked sender is
   * treated as live, so the day a real SMS provider replaces the simulation it records intents
   * without anyone remembering to say so.
   */
  readonly reachesAProvider?: boolean;
};

export type AlertSenders = Readonly<Record<AlertChannel, AlertSender>>;

/**
 * How long one provider request may take before it is abandoned as an outage.
 *
 * This bound is load-bearing rather than defensive. The poller sends due alerts one at a time and
 * holds the row's transaction open across the send, so a request that connects and then never
 * answers does not stall one alert — it stalls every later due alert behind it, for as long as the
 * socket stays open. AC 2 gives a two-minute delivery budget and the tick runs every 60 seconds,
 * so a request is given ten seconds and then treated as the outage it is: the alert stays queued
 * and the next tick retries it, which is the path the spec's provider-outage edge case describes.
 */
export const PROVIDER_TIMEOUT_MS = 10_000;

/**
 * Transport failures that PROVE the request never reached the provider.
 *
 * THE MEMBERSHIP RULE, so the next code is added or rejected by the rule rather than by whether
 * somebody has reported it yet: a code belongs here when EVERY path that can raise it lies before
 * the first request byte is written: name resolution, connection establishment, or the TLS
 * handshake. One path that can raise it after the body was written disqualifies the code, however
 * rare that path is, because the code is the whole of what this side ever learns. It is a rule
 * about the code, not about the outage: "in this outage nothing was sent" is not membership,
 * because the next occurrence of the same code need not be that outage.
 *
 * The asymmetry is deliberate and is why the rule demands proof rather than likelihood. A code
 * wrongly left out costs retries through an outage, which is the spec's edge case working. A code
 * wrongly let in closes the attempt, and a closed attempt is retried past the provider's 24-hour
 * dedup window, which is the second delivery the attempt record exists to prevent.
 *
 * EVALUATED AND REJECTED by that rule, recorded so they are not re-derived one report at a time:
 *   - `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_SOCKET`: each can arrive while connecting AND after the
 *     request body was written and accepted. The code cannot say which happened. (`ECONNRESET` was
 *     excluded on this ground in an earlier round and stays excluded.)
 *   - `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_RES_CONTENT_LENGTH_MISMATCH`,
 *     `UND_ERR_RES_EXCEEDED_MAX_SIZE`, `UND_ERR_REQUEST_RETRY`, `UND_ERR_RESPONSE`,
 *     `UND_ERR_HEADERS_OVERFLOW`, `HPE_*`: the request was fully written; the provider may be
 *     holding it.
 *   - `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH`: detected while writing the request body, so bytes
 *     were already on the socket.
 *   - `UND_ERR_ABORT`, `UND_ERR_ABORTED`, `UND_ERR_DESTROYED`, `UND_ERR_CLOSED`, `UND_ERR_INFO`,
 *     `UND_ERR_SOCKS5`, `UND_ERR`: one code for a whole lifecycle or subsystem rather than one
 *     phase of it, so no path guarantee can be made. This side's own ten-second abort lands here.
 *   - `UND_ERR_INVALID_ARG`, `UND_ERR_NOT_SUPPORTED`, `UND_ERR_INVALID_RETURN_VALUE`,
 *     `UND_ERR_BPL_MISSING_UPSTREAM`, `UND_ERR_MAX_ORIGINS_REACHED`, `UND_ERR_WS_*`: not transport
 *     failures of this request at all. They would be a bug or a misconfiguration here, and a
 *     retry classification is not the answer to either.
 */
const PROVEN_BEFORE_HANDOFF = new Set([
  // Name resolution and connection establishment: no socket was ever established, so no request
  // bytes existed to reach Resend.
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  // Undici's own connection-establishment failures, which is the class Node's `fetch` reports
  // instead of an errno. `UND_ERR_CONNECT_TIMEOUT` is raised by the connect timer, which is
  // cancelled the moment the socket is usable, so it can only fire with no socket to write to;
  // `UND_ERR_PRX_TLS` is the TLS connection TO a proxy failing, before the tunnel that would carry
  // the request exists (reachable whenever a proxy dispatcher is in play, NODE_USE_ENV_PROXY
  // included). Added 2026-08-04: a connect timeout outage lasting past the dedup window held every
  // alert behind it for good, though nothing had ever been handed over.
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_PRX_TLS",
  // TLS handshake failures. The handshake completes before any HTTP byte is written, so a
  // certificate this side refuses means the request was never sent. Added 2026-08-03: leaving
  // them unproven meant a certificate outage lasting past the dedup window permanently held every
  // alert behind it, even though no duplicate was ever possible.
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
]);

/** `fetch` wraps a transport failure, so the errno naming it sits on the cause chain. */
function failedBeforeHandoff(error: unknown): boolean {
  for (let link: unknown = error; link instanceof Error; link = link.cause) {
    // A dual-stack connect fails with one error PER ADDRESS TRIED, and Node copies only the first
    // attempt's code onto the aggregate. Reading that code alone judges the whole connect by
    // whichever address happened to be tried first, in both directions: it can claim proof the
    // other attempts do not support, and it can hide proof they do. So every attempt is read, and
    // one this side cannot account for leaves the attempt open.
    if (link instanceof AggregateError) {
      return link.errors.length > 0 && link.errors.every((cause) => failedBeforeHandoff(cause));
    }
    const { code } = link as { code?: unknown };
    if (typeof code === "string" && PROVEN_BEFORE_HANDOFF.has(code)) return true;
  }
  return false;
}

/**
 * Email via Resend's HTTP API (BASELINE.md provider baseline; live in the demo).
 *
 * The REST endpoint rather than the `resend` SDK: the only call this product makes is one POST,
 * and `Idempotency-Key` — the header AC 2 leans on — is part of the HTTP contract, not something
 * the SDK adds. One fewer vendor dependency for no lost capability.
 */
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
        // Bounds the whole request, connection included. Without it a half-open socket blocks the
        // poller indefinitely; with it the failure lands on the retry path like any other outage.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // A transport failure is exactly the outage the spec's edge case describes: retry later.
      // The timeout arrives here as an abort, and is named for what it is so an operator reading
      // `payload.last_error` can tell a refused connection from a provider that went quiet.
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new AlertDeliveryError(
        timedOut
          ? `email provider did not respond within ${timeoutMs}ms`
          : `email provider unreachable: ${error instanceof Error ? error.message : "unknown error"}`,
        // Resolved only for a failure that proves the request never left. A timeout does not, and
        // neither does a connection that died after the body was written.
        { outcomeObserved: failedBeforeHandoff(error) },
      );
    }
    // THE BODY IS RELEASED ON BOTH PATHS, and the throwing one is why this is a comment rather
    // than a line. Undici holds a connection open until its response body is consumed or
    // cancelled, so a body that is simply never read keeps its socket until garbage collection.
    // The poller sends up to eight at a time and retries through outages, which is exactly the
    // shape that accumulates them: the concurrency bound limits requests in flight, not sockets
    // left behind by requests that finished.
    //
    // Cancelled rather than read, because nothing here wants the contents. The provider's body can
    // echo the recipient, which is contact data (AGENTS.md "do not log unredacted contact data"),
    // so the rejection carries the status and nothing else.
    //
    // Releasing the body must not be able to overrule what the provider already said. A rejected
    // `cancel()` used to propagate as an ordinary error, which reports the outcome as UNOBSERVED —
    // so a teardown that kept failing until the oldest attempt aged past the dedup window held the
    // alert permanently, after a definitive response including a 2xx. The status is the outcome;
    // this is socket hygiene, and a failure at it is neither the organizer's problem nor evidence
    // about delivery.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      throw new AlertDeliveryError(
        `email provider rejected the send with status ${response.status}`,
        // The provider answered. Whatever that answer was, this side observed it.
        { outcomeObserved: true },
      );
    }
    return { simulated: false, label: null, provider: "resend" };
  };
}

/**
 * The email path with no credentials configured.
 *
 * Deliberately NOT a simulation. The spec permits a labeled simulation for SMS only, and an
 * unconfigured email channel that reported success would be a mock presented as a send
 * (AGENTS.md "do not claim completion while a mock is present"). Failing leaves the alert pending
 * for a later tick, so configuring the key later delivers it rather than losing it.
 */
export const UNCONFIGURED_EMAIL_ERROR =
  "RESEND_API_KEY and SMTP_FROM are not configured; email alerts stay pending until they are";

export function unconfiguredEmailSender(): AlertSender {
  const send: AlertSender = async () => {
    throw new AlertDeliveryError(UNCONFIGURED_EMAIL_ERROR);
  };
  // NO PROVIDER, for the same reason the SMS simulation carries this: the throw above happens
  // before a socket is opened, so nothing outside this process can be holding the message. Without
  // the marker an intent is written before the sender runs, and a crash after that insert and
  // before the outcome update commits leaves it unresolved forever — which ages into a hold and
  // keeps the alert out of every poll, so configuring the credentials later delivers nothing.
  return Object.assign(send, { reachesAProvider: false });
}

/**
 * The label an in-product simulated SMS carries, stored on the alert row so every reader shows the
 * same words.
 */
export const SIMULATED_SMS_LABEL =
  "SIMULATED SMS — not delivered. Twilio A2P 10DLC registration is still pending " +
  "(docs/BASELINE.md provider baseline; OPEN-QUESTIONS T-1), so SMS renders in-product rather " +
  "than sending.";

/**
 * SMS while A2P 10DLC registration is outstanding (DESIGN.md fallback, PRD risk table,
 * OPEN-QUESTIONS T-1). BASELINE.md records the registration as started and not approved, so this
 * is the path the repo's own artifacts select; a live Twilio sender is written when an approval
 * date is recorded, not before.
 *
 * `sent` here means "rendered", and the row says so: the delivery it returns is what puts
 * `SIMULATED_SMS_LABEL` on the alert. Nothing presents it as a delivered message.
 */
export function createSimulatedSmsSender(record?: (message: AlertMessage) => void): AlertSender {
  const send: AlertSender = async (message) => {
    record?.(message);
    return { simulated: true, label: SIMULATED_SMS_LABEL, provider: "simulated" };
  };
  return Object.assign(send, { reachesAProvider: false });
}

/**
 * The senders an api process runs with, from its environment. Email is live when configured and
 * fails loudly when it is not; SMS is the labeled simulation until the A2P approval is recorded.
 */
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
