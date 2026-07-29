"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  askedFields,
  intakeWarnings,
  type IntakeContract,
  type IntakeField,
  type IntakeIssue,
  type IntakeValue,
} from "@pop-engine/engine";
import { CREDENTIALED, loadEvent, regeneratePlan, type SavedEvent } from "./events-api";
import { discoverParks, parksBoroughCode, type ParkSuggestion } from "./parks-api";

// The intake questionnaire. Every question, option, and asked-when condition comes from
// the contract prop, which the server component parses from the published ruleset — this
// component holds no field list of its own.

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

const QUESTION_LABELS: Readonly<Record<string, string>> = {
  venue_paco_covers_exact_event: "Do the PACO materials cover this exact event?",
  venue_fdny_pa_permit_current_for_event_space:
    "Is the FDNY Public Assembly Permit current for this event space?",
};

const PACO_EVIDENCE_CHECKS = [
  "The documents identify the exact event space.",
  "They authorize the event use and assembly classification.",
  "They allow the event's maximum occupant load.",
  "The seating, furnishings, and layout match an approved primary or alternate plan.",
] as const;

const isBlank = (value: IntakeValue): boolean =>
  value === null || value === undefined || value === "";

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

/**
 * Fold a saved row back into the form without discarding anything typed while the save
 * was in flight.
 *
 * The answers as they stood when Save was pressed are the base of a three-way merge:
 * a question the organizer has answered differently since then keeps their newer
 * answer, and every other question takes the stored row, which is the answer of record.
 * The alternative — freezing all 32 controls for the length of the request — prevents
 * the edits rather than keeping them.
 */
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
  const [answers, setAnswers] = useState<Answers>({});
  const [saved, setSaved] = useState<SavedEvent | null>(null);
  const [planStale, setPlanStale] = useState(false);
  const [errors, setErrors] = useState<IntakeIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);
  const [regeneratedRevision, setRegeneratedRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(eventId !== undefined);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [parkSuggestions, setParkSuggestions] = useState<ParkSuggestion[] | null>(null);
  const [parkSearchFailure, setParkSearchFailure] = useState<string | null>(null);
  const [parkSearching, setParkSearching] = useState(false);

  // The revision the form is currently sitting on. A ref, because an in-flight
  // regeneration has to compare against the revision as it stands when the plan lands,
  // not against the one captured when the button was clicked.
  const currentRevision = useRef<number | null>(null);
  const parkSearchRequest = useRef(0);
  const parkSearchController = useRef<AbortController | null>(null);
  const locationNameInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (eventId === undefined) return;
    let abandoned = false;
    void loadEvent(apiBaseUrl, eventId).then((result) => {
      if (abandoned) return;
      if (result.ok) {
        setAnswers(answersFromEvent(contract, result.loaded.event));
        setSaved(result.loaded.event);
        currentRevision.current = result.loaded.event.revision_counter;
        setPlanStale(result.loaded.plan_stale);
      } else {
        setLoadFailure(result.message);
      }
      setLoading(false);
    });
    return () => {
      abandoned = true;
    };
  }, [apiBaseUrl, contract, eventId]);

  const questions = useMemo(() => askedFields(contract.fields, answers), [contract, answers]);
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
    setAnswers((current) => ({ ...current, [field]: value }));
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
      // A cleared optional is sent as an explicit null. Omitting it would leave the
      // stored value in place on an edit, so the organizer could never remove a venue
      // name or a capacity once one had been saved.
      const value = answers[question.field] ?? null;
      payload[question.field] = isBlank(value) ? null : value;
    }
    for (const field of contract.fields) {
      // A question this event is no longer asked is sent as an explicit null, so an
      // edit that hides a question clears its old answer instead of leaving a value
      // behind that validation would reject against a control nobody can see.
      const value = answers[field.field] ?? null;
      payload[field.field] = asked.has(field.field) && !isBlank(value) ? value : null;
    }
    return payload;
  };

  const save = async () => {
    setSaving(true);
    setFailure(null);
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
        setErrors(body.errors ?? []);
        if ((body.errors ?? []).length === 0) setFailure("The event could not be saved.");
        return;
      }
      setErrors([]);
      // The stored row is the answer of record, not what this form last held: a save
      // that hides questions clears them server-side, and rebuilding from the response
      // is what stops a cleared answer from lingering in a warning or coming back on
      // the next edit. Anything the organizer typed while the request was in flight is
      // newer than the response, so it survives the rebuild.
      const stored = answersFromEvent(contract, body.event);
      setAnswers((latest) => reconcileAnswers(latest, answersAtSubmit, stored));
      setSaved(body.event);
      currentRevision.current = body.event.revision_counter;
      setPlanStale(body.plan_stale === true);
    } catch {
      setFailure("The API could not be reached.");
    } finally {
      setSaving(false);
    }
  };

  // Spec #8: one click regenerates the plan for the revision just saved. The plan
  // endpoint belongs to F-201; intake calls it and reports what it answered.
  const regenerate = async (id: string, revision: number) => {
    setRegenerating(true);
    setRegenerationError(null);
    const result = await regeneratePlan(apiBaseUrl, id);
    setRegenerating(false);

    // A save can land while this was in flight. A plan for a superseded revision is
    // stale the moment it arrives, so it must not clear the warning or the button for
    // the revision the organizer is now on. Same when the plan names a revision that is
    // not the one on screen.
    const superseded =
      currentRevision.current !== revision ||
      (result.ok && result.eventRevision !== null && result.eventRevision !== revision);
    if (superseded) return;

    if (result.ok) {
      setPlanStale(false);
      setRegeneratedRevision(revision);
      return;
    }
    setRegenerationError(result.message);
  };

  if (loading) {
    return (
      <div className="intake">
        <p className="pe-eyebrow">PopEngine · Survey</p>
        <p className="intake__lede" role="status">
          Loading your event…
        </p>
      </div>
    );
  }

  // A form that could not load its event must not offer to save: saving would create a
  // second event rather than edit the one asked for.
  if (loadFailure !== null) {
    return (
      <div className="intake">
        <p className="pe-eyebrow">PopEngine · Survey</p>
        <h1>Edit your event</h1>
        <p className="intake__error" role="alert">
          {loadFailure}
        </p>
      </div>
    );
  }

  return (
    <form
      className="intake"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="pe-eyebrow">PopEngine · Survey</p>
      <h1>{eventId === undefined ? "Describe your event" : "Edit your event"}</h1>
      <p className="intake__lede">
        Answer what applies to your event. Questions appear as your answers make them relevant, and
        &ldquo;I don&rsquo;t know&rdquo; is a real answer — it is stored as unknown and carried into
        your plan.
      </p>

      {DESCRIPTIVE_QUESTIONS.map((question) => (
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
            aria-describedby={
              question.field === "location_name" && canSearchParks
                ? "intake-park-search-note"
                : undefined
            }
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
                Enter part of a park name to search NYC Parks, or keep typing any venue or location
                name manually.
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
                {parkSearchFailure !== null && <p className="intake__note">{parkSearchFailure}</p>}
                {parkSearchTooLong && (
                  <p className="intake__note">
                    Park searches must be 80 characters or fewer. You can still save this location
                    name manually.
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
          <FieldError issue={errorFor(question.field)} />
        </div>
      ))}

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
          {planStale && (
            <div className="intake__stale">
              <p>
                This edit is newer than the plan that was generated, so the plan is out of date.
              </p>
              <button
                type="button"
                onClick={() => void regenerate(saved.id, saved.revision_counter)}
                disabled={regenerating}
              >
                {regenerating ? "Regenerating plan…" : "Regenerate plan"}
              </button>
              {regenerationError !== null && (
                <p className="intake__error" role="alert">
                  {regenerationError}
                </p>
              )}
            </div>
          )}
          {planStale === false && regeneratedRevision !== null && (
            <p role="status">Plan regenerated for revision {regeneratedRevision}.</p>
          )}
        </section>
      )}
    </form>
  );
}

function FieldError({ issue }: { issue: IntakeIssue | undefined }) {
  if (issue === undefined) return null;
  return (
    <span className="intake__error" role="alert">
      {issue.message}
    </span>
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
  const label = QUESTION_LABELS[field.field] ?? humanize(field.field);
  return (
    <fieldset className="intake__question">
      <legend className="intake__question-head">
        <span className="intake__label">{humanize(field.field)}</span>
        <span className="intake__tag" aria-hidden="true">
          {field.field}
        </span>
      </legend>
      {field.note !== null && <p className="intake__note">{field.note}</p>}
      {field.field === "venue_paco_covers_exact_event" && (
        <div className="intake__note">
          <p>Check the PACO, certificate of occupancy, and approved plan for all four facts:</p>
          <ul>
            {PACO_EVIDENCE_CHECKS.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
          <p>
            Answer No if any check mismatches, Yes only if all four match, and I don&rsquo;t know
            otherwise. These checks are guidance; only the answer below is saved.
          </p>
        </div>
      )}
      <Control field={field} value={value} onAnswer={onAnswer} />
      <FieldError issue={issue} />
    </fieldset>
  );
}

function Control({
  field,
  value,
  onAnswer,
}: {
  field: IntakeField;
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
        {options.map((option) => (
          <label className="intake__option" key={option.value}>
            <input
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
        {(field.values ?? []).map((option) => (
          <label className="intake__option" key={option}>
            <input
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
      className="intake__input"
      name={field.field}
      type={field.type === "date" ? "date" : "number"}
      step={field.type === "number" ? "any" : undefined}
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
