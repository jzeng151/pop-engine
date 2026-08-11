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
import { CREDENTIALED, loadEvent, type SavedEvent } from "../_lib/events-api";
import { discoverParks, parksBoroughCode, type ParkSuggestion } from "./parks-api";

// The intake questionnaire.

type Answers = Record<string, IntakeValue>;

type ApiResponse = {
  event?: SavedEvent;
  errors?: IntakeIssue[];
  warnings?: IntakeIssue[];
  plan_stale?: boolean;
};

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

const CORRECTABLE_ERROR_CODES = new Set([
  "required",
  "invalid_value",
  "must_be_positive",
  "in_the_past",
]);

const isIntakeValue = (value: unknown): value is IntakeValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (Array.isArray(value) && value.every((entry) => typeof entry === "string"));

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
  const [errors, setErrors] = useState<IntakeIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
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

  useEffect(() => {
    if (eventId === undefined) return;
    let abandoned = false;
    void loadEvent(apiBaseUrl, eventId).then((result) => {
      if (abandoned) return;
      if (result.ok) {
        setAnswers(answersFromEvent(contract, result.loaded.event));
        setSaved(result.loaded.event);
      } else {
        setLoadFailure(result.message);
      }
      setLoading(false);
    });
    return () => {
      abandoned = true;
    };
  }, [apiBaseUrl, contract, eventId]);

  const questions = useMemo(() => {
    const invalidFields = new Set(
      validateIntake(contract, answers, nycToday())
        .errors.filter((error) => error.code === "invalid_value")
        .map((error) => error.field),
    );
    return askedFields(
      contract.fields,
      Object.fromEntries(Object.entries(answers).filter(([field]) => !invalidFields.has(field))),
    );
  }, [contract, answers]);
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
    const updatedAnswers = { ...answers, [field]: value };
    setAnswers(updatedAnswers);
    const remaining = validateIntake(contract, updatedAnswers, nycToday()).errors;
    setErrors((current) =>
      current.filter(
        (error) =>
          error.field !== field ||
          !CORRECTABLE_ERROR_CODES.has(error.code) ||
          remaining.some((candidate) => candidate.field === error.field),
      ),
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
    setFailure(null);
    const fieldOrder = [
      ...DESCRIPTIVE_QUESTIONS.map((question) => question.field),
      ...questions.map((question) => question.field),
    ];
    const clientErrors = validateIntake(contract, submission(), nycToday()).errors.map((error) => {
      if (error.code !== "required") return error;
      const label =
        DESCRIPTIVE_QUESTIONS.find((question) => question.field === error.field)?.label ??
        humanize(error.field);
      return { ...error, message: `${label} is required` };
    });
    clientErrors.sort(
      (left, right) => fieldOrder.indexOf(left.field) - fieldOrder.indexOf(right.field),
    );
    if (clientErrors.length > 0) {
      shouldFocusFirstError.current = true;
      setErrors(clientErrors);
      return;
    }

    setSaving(true);
    // The answers as they stand at the click, which the response is reconciled against.
    const answersAtSubmit = answers;
    try {
      const target = saved === null ? "/api/events" : `/api/events/${saved.id}`;
      const response = await fetch(`${apiBaseUrl}${target}`, {
        method: saved === null ? "POST" : "PATCH",
        ...CREDENTIALED,
        body: JSON.stringify(submission()),
      });
      const body = (await response.json()) as ApiResponse;
      if (!response.ok || body.event === undefined) {
        shouldFocusFirstError.current = true;
        setErrors(body.errors ?? []);
        if ((body.errors ?? []).length === 0) setFailure("The event could not be saved.");
        return;
      }
      setErrors([]);
      // Rebuild from the stored row so answers cleared by hidden questions cannot linger locally.
      const stored = answersFromEvent(contract, body.event);
      setAnswers((latest) => reconcileAnswers(latest, answersAtSubmit, stored));
      setSaved(body.event);
      router.push(`/events/${body.event.id}`);
    } catch {
      setFailure("The API could not be reached.");
    } finally {
      setSaving(false);
    }
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

        <button className="intake__submit" type="submit" disabled={saving}>
          {saved === null ? "Save event" : "Save changes"}
        </button>

        {saved !== null && (
          <section className="intake__saved" aria-live="polite">
            <p>
              Saved as revision {saved.revision_counter}.{" "}
              <a href={`/intake/${saved.id}`}>Come back to this event</a> to edit it later, or{" "}
              <a href={`/events/${saved.id}/plan`}>see its permit plan</a>.
            </p>
            <p>
              <a href={`/events/${saved.id}/promote`}>Promote public page</a>
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
