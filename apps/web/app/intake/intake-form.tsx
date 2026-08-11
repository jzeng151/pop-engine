"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  askedFields,
  intakeWarnings,
  validateIntake,
  type IntakeContract,
  type IntakeField,
  type IntakeIssue,
  type IntakeValue,
} from "@pop-engine/engine";
import {
  CREDENTIALED,
  clearPendingCreateForEvent,
  isIntakeValue,
  loadEvent,
  loadPendingCreate,
  regeneratePlan,
  storePendingCreate,
  type PendingCreate,
  type SavedEvent,
} from "../_lib/events-api";
import { loadPlan } from "../plan/plan-api";
import { discoverParks, parksBoroughCode, type ParkSuggestion } from "./parks-api";

// The intake questionnaire.

type Answers = Record<string, IntakeValue>;
type ApiResponse = {
  event?: SavedEvent;
  error?: string;
  errors?: IntakeIssue[];
  warnings?: IntakeIssue[];
  plan_stale?: boolean;
};

const CREATE_KEY_CONFLICT = "Idempotency-Key was already used with a different body";

function isDefinitiveCreateRejection(
  status: number,
  body: ApiResponse,
  retrying: boolean,
): boolean {
  return (
    (!retrying && status === 400 && Array.isArray(body.errors)) ||
    (status === 409 && body.error === CREATE_KEY_CONFLICT)
  );
}

/** Descriptive answers the events table carries that the ruleset does not declare. */
const DESCRIPTIVE_QUESTIONS = [
  { field: "name", label: "Event name", type: "text" as const, required: true },
  {
    field: "location_name",
    label: "Venue or location name",
    type: "text" as const,
    required: false,
  },
  {
    field: "capacity",
    label: "Confirmed capacity (optional)",
    type: "number" as const,
    required: false,
  },
];
const MAX_PARK_SEARCH_LENGTH = 80;

const visibleQuestions = (contract: IntakeContract, answers: Answers): readonly IntakeField[] => {
  const invalidFields = new Set(
    validateIntake(contract, answers, nycToday())
      .errors.filter((error) => error.code === "invalid_value")
      .map((error) => error.field),
  );
  return askedFields(
    contract.fields,
    Object.fromEntries(Object.entries(answers).filter(([field]) => !invalidFields.has(field))),
  );
};

const humanize = (token: string): string =>
  token.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

const optionLabel = (value: string): string =>
  value === "unknown" ? "I don't know" : humanize(value);

const isBlank = (value: IntakeValue | undefined): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const nycToday = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const CORRECTABLE_ERROR_CODES = new Set(["required", "invalid_value", "must_be_positive"]);

/**
 * The answers a saved event row already holds. Columns the form does not ask about
 * (id, status, timestamps) are left behind, and a null answer stays unanswered.
 */
function answersFromEvent(contract: IntakeContract, event: SavedEvent): Answers {
  const answers: Answers = {};
  const fields = [
    ...contract.fields.map((field) => field.field),
    ...DESCRIPTIVE_QUESTIONS.map((question) => question.field),
  ];
  for (const field of fields) {
    const value = event[field];
    if (value !== null && value !== undefined && isIntakeValue(value)) answers[field] = value;
  }
  return answers;
}

const sameAnswer = (left: IntakeValue, right: IntakeValue): boolean =>
  Array.isArray(left) || Array.isArray(right)
    ? Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      [...left].sort().every((value, index) => value === [...right].sort()[index])
    : left === right;

const sameAnswers = (left: Answers, right: Answers): boolean =>
  [...new Set([...Object.keys(left), ...Object.keys(right)])].every((field) =>
    sameAnswer(
      isBlank(left[field]) ? null : (left[field] ?? null),
      isBlank(right[field]) ? null : (right[field] ?? null),
    ),
  );

/** Fold a saved row back into the form without discarding anything typed while the save was in flight. */
function reconcileAnswers(current: Answers, atSubmit: Answers, stored: Answers): Answers {
  const merged: Answers = { ...stored };
  for (const field of new Set([...Object.keys(current), ...Object.keys(atSubmit)])) {
    const now = current[field] ?? null;
    if (sameAnswer(now, atSubmit[field] ?? null)) continue;
    if (now === null) delete merged[field];
    else merged[field] = now;
  }
  return merged;
}

export function IntakeForm({
  contract,
  apiBaseUrl,
  eventId,
}: {
  contract: IntakeContract;
  apiBaseUrl: string;
  /** Set on the edit route: the saved event this form loads and edits. */
  eventId?: string;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [saved, setSaved] = useState<SavedEvent | null>(null);
  const [initialPlanReady, setInitialPlanReady] = useState(false);
  const [errors, setErrors] = useState<IntakeIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [canDiscardCreateRecovery, setCanDiscardCreateRecovery] = useState(false);
  const [loading, setLoading] = useState(eventId !== undefined);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [parkSuggestions, setParkSuggestions] = useState<ParkSuggestion[] | null>(null);
  const [parkSearchFailure, setParkSearchFailure] = useState<string | null>(null);
  const [parkSearching, setParkSearching] = useState(false);

  const parkSearchRequest = useRef(0);
  const parkSearchController = useRef<AbortController | null>(null);
  const locationNameInput = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const shouldFocusFirstError = useRef(false);
  const currentAnswers = useRef<Answers>({});
  const pendingCreate = useRef<PendingCreate | null>(null);
  const pendingCreateReadFailed = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (eventId !== undefined) return;
    const restored = loadPendingCreate(apiBaseUrl);
    pendingCreateReadFailed.current = !restored.resolved;
    if (!restored.resolved) {
      setFailure(
        "This browser could not safely read or clear an earlier event recovery. Reload this page once session storage is available before saving another event.",
      );
      return;
    }
    if (restored.pending === null) return;
    pendingCreate.current = restored.pending;
    currentAnswers.current = restored.pending.answers;
    setAnswers(restored.pending.answers);
  }, [apiBaseUrl, eventId]);

  useEffect(() => {
    if (eventId === undefined) return;
    let abandoned = false;
    void loadEvent(apiBaseUrl, eventId).then((result) => {
      if (abandoned) return;
      if (result.ok) {
        const loadedAnswers = answersFromEvent(contract, result.loaded.event);
        currentAnswers.current = loadedAnswers;
        setAnswers(loadedAnswers);
        setSaved(result.loaded.event);
        setLoading(false);
        void loadPlan(apiBaseUrl, eventId).then((plan) => {
          const cleanupFailed = plan.ok && !clearPendingCreateForEvent(apiBaseUrl, eventId);
          if (cleanupFailed && !abandoned) {
            setFailure(
              "The permit plan is ready, but this browser could not clear its saved recovery information. Refresh this page to try again before creating another event.",
            );
          }
          if (!abandoned) setInitialPlanReady(plan.ok);
        });
      } else {
        setLoadFailure(result.message);
        setLoading(false);
      }
    });
    return () => {
      abandoned = true;
    };
  }, [apiBaseUrl, contract, eventId]);

  const questions = useMemo(() => visibleQuestions(contract, answers), [contract, answers]);
  // Contradictions and coverage gaps are shown while the organizer types, not only on
  // submit (spec #4, #5). The same function runs server-side on save.
  const warnings = useMemo(() => intakeWarnings(contract, answers), [contract, answers]);
  const errorFor = (field: string) => errors.find((error) => error.field === field);
  const parkBorough = parksBoroughCode(answers.borough);
  const canSearchParks = answers.location_type === "park" && parkBorough !== null;
  const parkSearchName =
    typeof answers.location_name === "string" ? answers.location_name.trim() : "";
  const parkSearchTooLong = parkSearchName.length > MAX_PARK_SEARCH_LENGTH;

  useEffect(() => {
    if (!shouldFocusFirstError.current) return;
    shouldFocusFirstError.current = false;
    const firstFieldError = errors.find(
      (error) => error.field !== "body" && error.code !== "unknown_field",
    );
    if (firstFieldError === undefined || formRef.current === null) return;

    const control = Array.from(formRef.current.elements).find(
      (element) =>
        element instanceof HTMLElement && element.getAttribute("name") === firstFieldError.field,
    );
    if (control instanceof HTMLElement) control.focus();
  }, [errors]);

  useEffect(() => {
    const visibleFields = new Set([
      ...DESCRIPTIVE_QUESTIONS.map((question) => question.field),
      ...questions.map((question) => question.field),
    ]);
    setErrors((current) => {
      const visible = current.filter(
        (error) =>
          error.field === "body" ||
          error.code === "unknown_field" ||
          visibleFields.has(error.field),
      );
      return visible.length === current.length ? current : visible;
    });
  }, [questions]);

  useEffect(() => {
    parkSearchRequest.current += 1;
    parkSearchController.current?.abort();
    parkSearchController.current = null;
    setParkSuggestions(null);
    setParkSearchFailure(null);
    setParkSearching(false);
  }, [answers.location_type, parkBorough]);

  useEffect(
    () => () => {
      parkSearchController.current?.abort();
    },
    [],
  );

  const answer = (field: string, value: IntakeValue) => {
    if (field === "location_name") {
      parkSearchRequest.current += 1;
      parkSearchController.current?.abort();
      parkSearchController.current = null;
      setParkSuggestions(null);
      setParkSearchFailure(null);
      setParkSearching(false);
    }
    const updatedAnswers = { ...currentAnswers.current, [field]: value };
    currentAnswers.current = updatedAnswers;
    setAnswers(updatedAnswers);
    const remaining = validateIntake(contract, updatedAnswers, nycToday()).errors;
    setErrors((current) =>
      current.flatMap((error) => {
        if (error.field !== field || !CORRECTABLE_ERROR_CODES.has(error.code)) return [error];
        const latest = remaining.find((candidate) => candidate.field === error.field);
        if (error.code === "required" && latest?.code !== "required") return latest ? [latest] : [];
        return latest ? [error] : [];
      }),
    );
  };

  const searchParks = async () => {
    if (!canSearchParks || parkBorough === null || parkSearchName.length === 0 || parkSearchTooLong)
      return;

    const request = ++parkSearchRequest.current;
    parkSearchController.current?.abort();
    const controller = new AbortController();
    parkSearchController.current = controller;
    setParkSearching(true);
    setParkSearchFailure(null);
    setParkSuggestions(null);

    const result = await discoverParks(apiBaseUrl, parkBorough, parkSearchName, controller.signal);
    if (parkSearchRequest.current !== request) return;

    parkSearchController.current = null;
    setParkSearching(false);
    if (result.ok) {
      setParkSuggestions(result.spaces);
      return;
    }
    setParkSearchFailure(
      `${result.message} You can still enter and save the location name manually.`,
    );
  };

  const submission = (): Record<string, IntakeValue> => {
    const asked = new Set(questions.map((question) => question.field));
    const payload: Record<string, IntakeValue> = {};
    for (const question of DESCRIPTIVE_QUESTIONS) {
      // A cleared optional is sent as an explicit null.
      const value = answers[question.field] ?? null;
      payload[question.field] = isBlank(value) ? null : value;
    }
    for (const field of contract.fields) {
      // A question this event is no longer asked is sent as an explicit null, so an edit that hides a question clears its old answer instead of leaving a value behind that validation would reject against a control nobody can.
      const value = answers[field.field] ?? null;
      payload[field.field] = asked.has(field.field) && !isBlank(value) ? value : null;
    }
    return payload;
  };

  const save = async () => {
    if (pendingCreateReadFailed.current) {
      setFailure(
        "This browser could not safely read or clear an earlier event recovery. Reload this page once session storage is available before saving another event.",
      );
      return;
    }
    setFailure(null);
    const retry = pendingCreate.current;
    const creating = saved === null || retry !== null;
    const requestBody = retry?.body ?? submission();
    if (retry === null) {
      const fieldOrder = [
        ...DESCRIPTIVE_QUESTIONS.map((question) => question.field),
        ...questions.map((question) => question.field),
      ];
      const validationErrors = validateIntake(contract, requestBody, nycToday()).errors;
      const missing = validationErrors
        .filter((error) => error.code === "required")
        .map((error) => {
          const label =
            DESCRIPTIVE_QUESTIONS.find((question) => question.field === error.field)?.label ??
            humanize(error.field);
          return { ...error, message: `${label} is required` };
        });
      const missingFields = new Set(missing.map((error) => error.field));
      const clientErrors = [
        ...errors.filter(
          (error) =>
            error.code !== "required" &&
            !missingFields.has(error.field) &&
            (error.field === "body" ||
              error.code === "unknown_field" ||
              error.code === "in_the_past" ||
              validationErrors.some((candidate) => candidate.field === error.field)),
        ),
        ...missing,
      ];
      clientErrors.sort(
        (left, right) => fieldOrder.indexOf(left.field) - fieldOrder.indexOf(right.field),
      );
      if (missing.length > 0) {
        shouldFocusFirstError.current = true;
        setErrors(clientErrors);
        return;
      }
    }

    // The answers as they stand at the click, which the response is reconciled against.
    const answersAtSubmit = retry?.answers ?? currentAnswers.current;
    if (creating && retry === null) {
      pendingCreate.current = {
        key: crypto.randomUUID(),
        body: requestBody,
        answers: answersAtSubmit,
      };
      if (!storePendingCreate(apiBaseUrl, pendingCreate.current)) {
        pendingCreate.current = null;
        setFailure(
          "This browser could not store the recovery information required to create an event. Enable session storage and try again.",
        );
        return;
      }
    }
    setSaving(true);
    try {
      const target = creating ? "/api/events" : `/api/events/${saved.id}`;
      const response = await fetch(`${apiBaseUrl}${target}`, {
        method: creating ? "POST" : "PATCH",
        ...CREDENTIALED,
        headers: creating
          ? {
              ...CREDENTIALED.headers,
              "Idempotency-Key": pendingCreate.current?.key ?? "",
            }
          : CREDENTIALED.headers,
        body: JSON.stringify(requestBody),
      });
      const body = (await response.json()) as ApiResponse;
      if (!response.ok || body.event === undefined) {
        if (
          mounted.current &&
          retry !== null &&
          response.status === 400 &&
          Array.isArray(body.errors)
        ) {
          setCanDiscardCreateRecovery(true);
        }
        if (creating && isDefinitiveCreateRejection(response.status, body, retry !== null)) {
          pendingCreate.current = null;
          storePendingCreate(apiBaseUrl, null);
        }
        if (!mounted.current) return;
        const latestAnswers = currentAnswers.current;
        const latestErrors = validateIntake(contract, latestAnswers, nycToday()).errors;
        const visibleFields = new Set([
          ...DESCRIPTIVE_QUESTIONS.map((question) => question.field),
          ...visibleQuestions(contract, latestAnswers).map((question) => question.field),
        ]);
        const responseErrors = (body.errors ?? []).filter(
          (error) =>
            error.field === "body" ||
            error.code === "unknown_field" ||
            (visibleFields.has(error.field) &&
              (error.code === "in_the_past" ||
                sameAnswer(
                  latestAnswers[error.field] ?? null,
                  answersAtSubmit[error.field] ?? null,
                ) ||
                latestErrors.some((candidate) => candidate.field === error.field))),
        );
        shouldFocusFirstError.current = true;
        setErrors(responseErrors);
        if (responseErrors.length === 0) {
          setFailure(
            (body.errors ?? []).length === 0
              ? "The event could not be saved."
              : "Your corrected answers were not saved. Save again to store them.",
          );
        }
        return;
      }
      if (mounted.current) setCanDiscardCreateRecovery(false);
      // Rebuild from the stored row so answers cleared by hidden questions cannot linger locally.
      const stored = answersFromEvent(contract, body.event);
      let eventRecoveryStored = true;
      if (creating && pendingCreate.current !== null) {
        pendingCreate.current = { ...pendingCreate.current, eventId: body.event.id };
        eventRecoveryStored = storePendingCreate(apiBaseUrl, pendingCreate.current);
      }
      if (mounted.current) {
        setErrors([]);
        const reconciled = reconcileAnswers(currentAnswers.current, answersAtSubmit, stored);
        currentAnswers.current = reconciled;
        setAnswers(reconciled);
        setSaved(body.event);
      }
      if (creating) {
        if (!eventRecoveryStored) {
          if (mounted.current) {
            setFailure(
              "Your event was saved, but its permit plan was not generated because this browser could not update its recovery information. Keep this tab open and save again to retry safely.",
            );
          }
          return;
        }
        const generated = await regeneratePlan(
          apiBaseUrl,
          body.event.id,
          pendingCreate.current?.key,
        );
        const generationMessage = generated.ok ? "" : generated.message;
        let planStored: boolean | null = false;
        if (generated.ok || !generated.refused) {
          const loaded = await loadPlan(apiBaseUrl, body.event.id);
          planStored = loaded.ok ? true : null;
        }
        const changedWhileSaving = !sameAnswers(currentAnswers.current, stored);
        if (planStored === null) {
          if (mounted.current) {
            setFailure(
              `Your event was saved, but it is not known whether its permit plan was generated. ${generationMessage} Open the permit plan to check before trying again.${changedWhileSaving ? " Changes made while the request was running are still unsaved." : ""}`,
            );
          }
          return;
        }
        if (!planStored) {
          pendingCreate.current = null;
          storePendingCreate(apiBaseUrl, null);
          if (mounted.current) {
            setFailure(
              `Your event was saved, but its permit plan could not be generated. ${generationMessage}${changedWhileSaving ? " Changes made while the request was running are still unsaved." : ""}`,
            );
          }
          return;
        }
        if (!clearPendingCreateForEvent(apiBaseUrl, body.event.id)) {
          if (mounted.current) {
            setFailure(
              "Your event and its permit plan were saved, but this browser could not clear its saved recovery information. Keep this tab open and try again before creating another event.",
            );
          }
          return;
        }
        pendingCreate.current = null;
        if (!mounted.current) return;
        setInitialPlanReady(true);
        if (changedWhileSaving) {
          setFailure(
            "Your event and its permit plan were saved, but changes made while they were saving are still unsaved. Save those changes before opening the plan.",
          );
          return;
        }
        router.push(`/events/${body.event.id}/plan`);
        return;
      }
      if (mounted.current) router.push(`/events/${body.event.id}`);
    } catch {
      if (mounted.current) setFailure("The API could not be reached.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const discardCreateRecovery = () => {
    if (!storePendingCreate(apiBaseUrl, null)) {
      setFailure(
        "This browser could not discard the saved recovery information. Keep this tab open and try again.",
      );
      return;
    }
    pendingCreate.current = null;
    setCanDiscardCreateRecovery(false);
    setErrors([]);
    setFailure(
      "The previous recovery was discarded. Review the current answers, then save to create a new event.",
    );
  };

  if (loading) {
    return (
      <main className="intake">
        <p className="pe-eyebrow">PopEngine · Survey</p>
        <p className="intake__lede" role="status">
          Loading your event…
        </p>
      </main>
    );
  }

  // A form that could not load its event must not offer to save: saving would create a
  // second event rather than edit the one asked for.
  if (loadFailure !== null) {
    return (
      <main className="intake">
        <p className="pe-eyebrow">PopEngine · Survey</p>
        <h1>Edit your event</h1>
        <p className="intake__error" role="alert">
          {loadFailure}
        </p>
      </main>
    );
  }

  return (
    <main>
      <form
        ref={formRef}
        className="intake"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="pe-eyebrow">PopEngine · Survey</p>
        <h1>{eventId === undefined ? "Describe your event" : "Edit your event"}</h1>
        <p className="intake__lede">
          Answer what applies to your event. Questions appear as your answers make them relevant,
          and &ldquo;I don&rsquo;t know&rdquo; is a real answer — it is stored as unknown and
          carried into your plan.
        </p>

        {errors.some((error) => error.field !== "body" && error.code !== "unknown_field") && (
          <section className="intake__error-summary" aria-labelledby="intake-error-summary-title">
            <p id="intake-error-summary-title">
              <strong>Fix these answers before saving:</strong>
            </p>
            <ul>
              {errors
                .filter((error) => error.field !== "body" && error.code !== "unknown_field")
                .map((error) => (
                  <li key={`${error.field}-${error.code}`}>
                    <a
                      href={`#intake-${error.field}`}
                      onClick={() => document.getElementById(`intake-${error.field}`)?.focus()}
                    >
                      {error.message}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {DESCRIPTIVE_QUESTIONS.map((question) => {
          const issue = errorFor(question.field);
          const errorId = `intake-${question.field}-error`;
          const describedBy = [
            question.field === "location_name" && canSearchParks ? "intake-park-search-note" : null,
            issue === undefined ? null : errorId,
          ]
            .filter((id): id is string => id !== null)
            .join(" ");

          return (
            <div className="intake__question" key={question.field}>
              <span className="intake__question-head">
                <label className="intake__label" htmlFor={`intake-${question.field}`}>
                  {question.label}
                </label>
                <span className="intake__tag" aria-hidden="true">
                  {question.field}
                </span>
              </span>
              <input
                id={`intake-${question.field}`}
                ref={question.field === "location_name" ? locationNameInput : undefined}
                className="intake__input"
                name={question.field}
                type={question.type}
                required={question.required}
                aria-describedby={describedBy.length === 0 ? undefined : describedBy}
                aria-invalid={issue === undefined ? undefined : true}
                value={String(answers[question.field] ?? "")}
                onChange={(event) => {
                  const raw = event.target.value;
                  answer(
                    question.field,
                    question.type === "number" ? (raw === "" ? null : Number(raw)) : raw,
                  );
                }}
              />
              {question.field === "location_name" && canSearchParks && (
                <div className="intake__park-search">
                  <p className="intake__note" id="intake-park-search-note">
                    Enter part of a park name to search NYC Parks, or keep typing any venue or
                    location name manually.
                  </p>
                  <button
                    className="intake__secondary"
                    type="button"
                    aria-controls="intake-park-search-results"
                    disabled={parkSearching || parkSearchName.length === 0 || parkSearchTooLong}
                    onClick={() => void searchParks()}
                  >
                    {parkSearching ? "Searching NYC Parks…" : "Search NYC Parks"}
                  </button>
                  <div id="intake-park-search-results" aria-busy={parkSearching} aria-live="polite">
                    {parkSearchFailure !== null && (
                      <p className="intake__note">{parkSearchFailure}</p>
                    )}
                    {parkSearchTooLong && (
                      <p className="intake__note">
                        Park searches must be 80 characters or fewer. You can still save this
                        location name manually.
                      </p>
                    )}
                    {parkSearching === false &&
                      parkSearchFailure === null &&
                      !parkSearchTooLong &&
                      parkSuggestions === null &&
                      parkSearchName.length > 0 && (
                        <p className="intake__note">Search to see matching NYC park names.</p>
                      )}
                    {parkSearching === false &&
                      parkSearchFailure === null &&
                      parkSuggestions?.length === 0 && (
                        <p className="intake__note">
                          No matching parks found. You can still save the location name manually.
                        </p>
                      )}
                    {parkSuggestions !== null && parkSuggestions.length > 0 && (
                      <ul className="intake__park-results" aria-label="NYC park suggestions">
                        {parkSuggestions.map((park) => (
                          <li key={park.locationId}>
                            <button
                              type="button"
                              onClick={() => {
                                answer("location_name", park.parkName);
                                locationNameInput.current?.focus();
                              }}
                            >
                              {park.parkName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              <FieldError id={errorId} issue={issue} />
            </div>
          );
        })}

        {questions.map((question) => (
          <Question
            key={question.field}
            field={question}
            value={answers[question.field] ?? null}
            issue={errorFor(question.field)}
            onAnswer={(value) => answer(question.field, value)}
          />
        ))}

        {warnings.map((warning) => (
          <p className="intake__warning" key={warning.code} role="status">
            <strong>{humanize(warning.code)}:</strong> {warning.message}
            {warning.ruleId !== undefined && (
              // The published rule and its verification status stay visible end to end:
              // a COVERAGE_GAP notice must never read as a confirmed requirement.
              <span className="intake__provenance">
                {warning.ruleId} · {warning.verificationStatus}
              </span>
            )}
          </p>
        ))}

        {errors
          .filter((error) => error.code === "unknown_field" || error.field === "body")
          .map((error) => (
            <p className="intake__error" key={error.field} role="alert">
              {error.message}
            </p>
          ))}
        {failure !== null && (
          <p className="intake__error" role="alert">
            {failure}
          </p>
        )}

        {canDiscardCreateRecovery && (
          <section className="intake__warning" aria-label="Create recovery options">
            <p>
              The earlier request may still finish. Check that it did not create an event before
              discarding recovery, or a new save could create a duplicate.
            </p>
            <button className="intake__secondary" type="button" onClick={discardCreateRecovery}>
              Discard recovery and start over
            </button>
          </section>
        )}

        <button className="intake__submit" type="submit" disabled={saving}>
          {saved === null ? "Save event" : "Save changes"}
        </button>

        {saved !== null && (
          <section className="intake__saved" aria-live="polite">
            <p>
              Saved as revision {saved.revision_counter}.{" "}
              <a href={`/intake/${saved.id}`}>Come back to this event</a> to edit it later
              {saving ? (
                ", while its permit plan is being generated."
              ) : (
                <>
                  , or <a href={`/events/${saved.id}/plan`}>see its permit plan</a>.
                </>
              )}
            </p>
            <p>
              {initialPlanReady ? (
                <a href={`/events/${saved.id}/promote`}>Promote public page</a>
              ) : (
                "Promotion will be available after the permit plan is generated."
              )}
              {" · "}
              <a href={`/events/${saved.id}/guests`}>Guest list</a>
            </p>
          </section>
        )}
      </form>
    </main>
  );
}

function FieldError({ id, issue }: { id: string; issue: IntakeIssue | undefined }) {
  if (issue === undefined) return null;
  return (
    <span className="intake__error" id={id} role="alert">
      {issue.message}
    </span>
  );
}

function Guidance({ note }: { note: string }) {
  const blocks: ({ text: string } | { items: string[] })[] = [];
  for (const line of note.split("\n").filter((part) => part.length > 0)) {
    if (line.startsWith("- ")) {
      const previous = blocks.at(-1);
      if (previous !== undefined && "items" in previous) previous.items.push(line.slice(2));
      else blocks.push({ items: [line.slice(2)] });
    } else {
      blocks.push({ text: line });
    }
  }

  return blocks.map((block, index) =>
    "items" in block ? (
      <ul className="intake__note" key={index}>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ) : (
      <p className="intake__note" key={index}>
        {block.text}
      </p>
    ),
  );
}

function Question({
  field,
  value,
  issue,
  onAnswer,
}: {
  field: IntakeField;
  value: IntakeValue;
  issue: IntakeIssue | undefined;
  onAnswer: (value: IntakeValue) => void;
}) {
  const labelId = `intake-${field.field}-label`;
  const guidanceId = `intake-${field.field}-guidance`;
  const errorId = `intake-${field.field}-error`;
  const describedBy = [
    field.note === null ? null : guidanceId,
    issue === undefined ? null : errorId,
  ]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <fieldset
      className="intake__question"
      aria-describedby={describedBy.length === 0 ? undefined : describedBy}
      aria-invalid={issue === undefined ? undefined : true}
    >
      <legend className="intake__question-head">
        <span className="intake__label" id={labelId}>
          {humanize(field.field)}
        </span>
        <span className="intake__tag" aria-hidden="true">
          {field.field}
        </span>
      </legend>
      {field.note !== null && (
        <div id={guidanceId}>
          <Guidance note={field.note} />
        </div>
      )}
      <Control
        describedBy={describedBy}
        field={field}
        invalid={issue !== undefined}
        labelId={labelId}
        value={value}
        onAnswer={onAnswer}
      />
      <FieldError id={errorId} issue={issue} />
    </fieldset>
  );
}

function Control({
  describedBy,
  field,
  invalid,
  labelId,
  value,
  onAnswer,
}: {
  describedBy: string;
  field: IntakeField;
  invalid: boolean;
  labelId: string;
  value: IntakeValue;
  onAnswer: (value: IntakeValue) => void;
}) {
  if (field.type === "enum" || field.type === "boolean") {
    const options: { value: string; label: string }[] =
      field.type === "boolean"
        ? [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]
        : (field.values ?? []).map((option) => ({ value: option, label: optionLabel(option) }));
    return (
      <div className="intake__options">
        {options.map((option, index) => (
          <label className="intake__option" key={option.value}>
            <input
              id={index === 0 ? `intake-${field.field}` : undefined}
              type="radio"
              name={field.field}
              value={option.value}
              checked={String(value) === option.value}
              onChange={() =>
                onAnswer(field.type === "boolean" ? option.value === "true" : option.value)
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  if (field.type === "multi_enum") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="intake__options">
        {(field.values ?? []).map((option, index) => (
          <label className="intake__option" key={option}>
            <input
              id={index === 0 ? `intake-${field.field}` : undefined}
              type="checkbox"
              name={field.field}
              value={option}
              checked={selected.includes(option)}
              onChange={(event) => onAnswer(toggleOption(selected, option, event.target.checked))}
            />
            {optionLabel(option)}
          </label>
        ))}
      </div>
    );
  }

  return (
    <input
      id={`intake-${field.field}`}
      className="intake__input"
      name={field.field}
      type={field.type === "date" ? "date" : "number"}
      step={field.type === "number" ? "any" : undefined}
      aria-describedby={describedBy.length === 0 ? undefined : describedBy}
      aria-invalid={invalid ? true : undefined}
      aria-labelledby={labelId}
      value={value === null ? "" : String(value)}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") return onAnswer(null);
        onAnswer(field.type === "date" ? raw : Number(raw));
      }}
    />
  );
}

/** "None" is exclusive, so it clears the other options and they clear it. */
function toggleOption(
  selected: readonly string[],
  option: string,
  checked: boolean,
): readonly string[] {
  if (!checked) return selected.filter((value) => value !== option);
  if (option === "none") return ["none"];
  return [...selected.filter((value) => value !== "none"), option];
}
