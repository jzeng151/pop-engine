// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseIntakeContract } from "@pop-engine/engine";
import { publishedRulesFileIn } from "../rules-file";
import { IntakeForm } from "./intake-form";

// Component tests for the questionnaire. The contract is parsed from the published
// ruleset, not a stub, so a registry change moves these tests the same way it moves the
// screen. Only `fetch` is faked: the api's own behavior is covered by the integration
// suite in apps/api.

// Resolved from the repo root, which is vitest's working directory: under jsdom
// `import.meta.url` is the document's http URL, not a file one.
const contract = parseIntakeContract(
  JSON.parse(readFileSync(resolve(publishedRulesFileIn("rules")), "utf8")),
);

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const savedEvent = (overrides: Record<string, unknown> = {}) => ({
  event: { id: "event-1", revision_counter: 1, ...overrides },
  warnings: [],
  plan_stale: false,
});

/**
 * The api answers a save with the row it stored, which is the submission plus the
 * lifecycle columns. Echoing the request keeps the fake honest about the one thing
 * these tests turn on: a field the submission cleared comes back null.
 */
const echoSavedEvent = (
  status: number,
  init: RequestInit,
  overrides: Record<string, unknown> = {},
): Response =>
  jsonResponse(status, {
    ...savedEvent({ ...JSON.parse(String(init.body)), ...overrides }),
  });

/** The questions on screen, by their legend label, in the order they are asked. */
const questionsOnScreen = (): string[] =>
  screen
    .getAllByRole("group")
    .map(
      (group) =>
        group.querySelector("legend .intake__label")?.textContent ??
        group.querySelector("legend")?.textContent ??
        "",
    );

const renderForm = (eventId?: string, activeContract = contract) => {
  const user = userEvent.setup();
  render(
    <IntakeForm contract={activeContract} apiBaseUrl="https://api.example.com" eventId={eventId} />,
  );
  return user;
};

/** Answer a radio question by its field name and the value the registry declares. */
const chooseOption = async (
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  value: string,
) => {
  const option = document.querySelector<HTMLInputElement>(
    `input[name="${field}"][value="${value}"]`,
  );
  if (option === null) throw new Error(`no option ${field}=${value} on screen`);
  await user.click(option);
};

const fillField = async (
  user: ReturnType<typeof userEvent.setup>,
  field: string,
  value: string,
) => {
  const input = document.querySelector<HTMLInputElement>(`input[name="${field}"]`);
  if (input === null) throw new Error(`no input ${field} on screen`);
  await user.clear(input);
  await user.type(input, value);
};

/** Fill in a minimal park event: every always-asked question, nothing conditional. */
const answerParkEvent = async (user: ReturnType<typeof userEvent.setup>) => {
  await fillField(user, "name", "Prospect Park Community Day");
  await chooseOption(user, "borough", "brooklyn");
  await chooseOption(user, "location_type", "park");
  await fillField(user, "headcount", "150");
  await fillField(user, "event_date", "2026-09-16");
  await chooseOption(user, "event_open_to_public", "yes");
  await chooseOption(user, "food_present", "false");
  await chooseOption(user, "selling_anything", "false");
  await chooseOption(user, "amplified_sound", "true");
  await chooseOption(user, "structure_types", "none");
  await chooseOption(user, "open_flame_or_cooking", "none");
  await chooseOption(user, "generator_present", "false");
  await chooseOption(user, "alcohol", "false");
};

const save = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /^Save/ }));
};

const requestBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> =>
  JSON.parse(String((fetchMock.mock.calls[call]?.[1] as RequestInit).body));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => echoSavedEvent(201, init));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("conditional reveal follows the registry (spec #2)", () => {
  it("asks only the always-asked questions before anything is answered", async () => {
    renderForm();
    const asked = questionsOnScreen();
    expect(asked).toEqual(
      contract.fields
        .filter((field) => field.askedWhen.length === 0)
        .map((field) => field.field.replace(/_/g, " ").replace(/^./, (l) => l.toUpperCase())),
    );
    expect(asked).not.toContain("Obstructs public way");
    expect(screen.getByRole("spinbutton", { name: "Headcount" })).toBeDefined();
  });

  it("reveals the SAPO chain one answer at a time", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "street");
    expect(questionsOnScreen()).toContain("Obstructs public way");
    expect(questionsOnScreen()).not.toContain("Sapo event type");

    await chooseOption(user, "obstructs_public_way", "yes");
    expect(questionsOnScreen()).toContain("Sapo event type");
    expect(questionsOnScreen()).not.toContain("Street event size");

    await chooseOption(user, "sapo_event_type", "street_event");
    expect(questionsOnScreen()).toContain("Street event size");
    expect(questionsOnScreen()).not.toContain("Plaza level");
  });

  it("asks plaza questions for a plaza and structure dimensions for a tent", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "plaza");
    await chooseOption(user, "obstructs_public_way", "yes");
    await chooseOption(user, "sapo_event_type", "plaza_event");
    expect(questionsOnScreen()).toEqual(
      expect.arrayContaining(["Plaza level", "Plaza multiple blocks"]),
    );
    expect(questionsOnScreen()).not.toContain("Street event size");

    await chooseOption(user, "structure_types", "tent_canopy");
    expect(questionsOnScreen()).toEqual(
      expect.arrayContaining(["Tent area sqft", "Tent days in place", "Structure over 10ft tall"]),
    );
    expect(questionsOnScreen()).not.toContain("Stage height ft");
  });

  it("asks the venue questions only once the headcount reaches the threshold", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "private_venue");
    await fillField(user, "headcount", "74");
    expect(questionsOnScreen()).not.toContain("Venue paco covers exact event");
    expect(questionsOnScreen()).not.toContain("Venue fdny pa permit current for event space");

    await fillField(user, "headcount", "75");
    expect(questionsOnScreen()).toEqual(
      expect.arrayContaining([
        "Venue paco covers exact event",
        "Venue fdny pa permit current for event space",
      ]),
    );

    await chooseOption(user, "amplified_sound", "true");
    expect(questionsOnScreen()).toContain("Sound audible from public way");
    await chooseOption(user, "alcohol", "true");
    expect(questionsOnScreen()).toContain("Venue license covers event area");
  });

  it("never asks the deprecated food-exception claim", async () => {
    const user = renderForm();
    await chooseOption(user, "food_present", "true");
    await chooseOption(user, "event_open_to_public", "no");
    expect(
      document.querySelector('input[name="food_affinity_private_exception_claimed"]'),
    ).toBeNull();
  });

  it("renders PACO evidence guidance from the active registry instead of web copy", async () => {
    const alternateGuidance = [
      "Alternate published introduction.",
      "- First active-contract check.",
      "- Second active-contract check.",
      "Alternate published fold guidance.",
    ].join("\n");
    const activeContract = {
      ...contract,
      fields: contract.fields.map((field) =>
        field.field === "venue_paco_covers_exact_event"
          ? { ...field, note: alternateGuidance }
          : field,
      ),
    };
    const user = renderForm(undefined, activeContract);
    await chooseOption(user, "location_type", "private_venue");
    await fillField(user, "headcount", "75");

    expect(screen.getByText("Alternate published introduction.").tagName).toBe("P");
    expect(screen.getByText("Alternate published fold guidance.").tagName).toBe("P");
    const list = screen.getByRole("list");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["First active-contract check.", "Second active-contract check."]);
    expect(screen.queryByText(/The documents identify the exact event space/)).toBeNull();
  });

  it("renders all published PACO checks and tri-state fold instructions", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "private_venue");
    await fillField(user, "headcount", "75");

    const question = screen.getByRole("group", { name: "Venue paco covers exact event" });
    expect(
      within(question)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Identifies the exact event space.",
      "Authorizes the event use and assembly classification.",
      "Allows the event's maximum occupant load.",
      "Matches the event's seating, furnishings, and layout.",
    ]);
    for (const instruction of [
      "Answer No if any checklist item has a proved mismatch.",
      "Answer Yes if all checklist items are proved.",
      "Answer I don't know otherwise.",
    ]) {
      expect(within(question).getByText(instruction).tagName).toBe("P");
    }
  });

  it("renders the registry's published note as the question's help text", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "street");
    const note = contract.fields.find((field) => field.field === "obstructs_public_way")?.note;
    expect(note).not.toBeNull();
    expect(screen.getByText(String(note))).toBeDefined();
  });

  it("clears the other options when the exclusive none is chosen, and back", async () => {
    const user = renderForm();
    await chooseOption(user, "open_flame_or_cooking", "charcoal_wood");
    await chooseOption(user, "open_flame_or_cooking", "propane_lpg");
    const checked = () =>
      [...document.querySelectorAll<HTMLInputElement>('input[name="open_flame_or_cooking"]')]
        .filter((input) => input.checked)
        .map((input) => input.value);
    expect(checked()).toEqual(["charcoal_wood", "propane_lpg"]);

    await chooseOption(user, "open_flame_or_cooking", "none");
    expect(checked()).toEqual(["none"]);

    await chooseOption(user, "open_flame_or_cooking", "charcoal_wood");
    expect(checked()).toEqual(["charcoal_wood"]);

    await chooseOption(user, "open_flame_or_cooking", "charcoal_wood");
    expect(checked()).toEqual([]);
  });
});

describe("'I don't know' is a real answer (spec #3)", () => {
  it("labels the registry's unknown option in plain words", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "street");
    const question = screen.getByRole("group", { name: /Obstructs public way/ });
    expect(within(question).getByText("I don't know")).toBeDefined();
  });

  it("submits unknown as unknown, never as false or blank", async () => {
    const user = renderForm();
    await answerParkEvent(user);
    await chooseOption(user, "event_open_to_public", "unknown");
    await save(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestBody(fetchMock).event_open_to_public).toBe("unknown");
  });

  it("submits both assembly-document answers as explicit tri-states", async () => {
    const user = renderForm();
    await answerParkEvent(user);
    await chooseOption(user, "location_type", "private_venue");
    await chooseOption(user, "sound_audible_from_public_way", "unknown");
    await chooseOption(user, "venue_paco_covers_exact_event", "unknown");
    await chooseOption(user, "venue_fdny_pa_permit_current_for_event_space", "no");
    await save(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestBody(fetchMock)).toMatchObject({
      venue_paco_covers_exact_event: "unknown",
      venue_fdny_pa_permit_current_for_event_space: "no",
    });
  });

  it("sends a blank optional quantity as null rather than zero", async () => {
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = requestBody(fetchMock);
    expect(body.battery_system_kwh).toBeNull();
    expect(body).toHaveProperty("capacity", null);
  });

  it("keeps a quantity that was typed and then cleared out of the submission", async () => {
    const user = renderForm();
    await answerParkEvent(user);
    // The kWh question is only on screen once the battery question is answered yes (nyc.v2.5).
    await chooseOption(user, "battery_present", "true");
    await fillField(user, "battery_system_kwh", "20.5");
    await fillField(user, "capacity", "400");
    const battery = document.querySelector<HTMLInputElement>('input[name="battery_system_kwh"]');
    expect(battery?.value).toBe("20.5");

    await user.clear(battery as HTMLInputElement);
    await save(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestBody(fetchMock).battery_system_kwh).toBeNull();
    expect(requestBody(fetchMock).capacity).toBe(400);
  });
});

describe("loading a saved event to edit it", () => {
  const storedEvent = {
    id: "event-9",
    revision_counter: 4,
    name: "Prospect Park Community Day",
    location_name: "Long Meadow",
    capacity: 400,
    borough: "brooklyn",
    location_type: "park",
    headcount: 150,
    event_date: "2026-09-16",
    event_open_to_public: "yes",
    food_present: false,
    selling_anything: false,
    amplified_sound: true,
    structure_types: ["none"],
    open_flame_or_cooking: ["none"],
    generator_present: false,
    battery_system_kwh: null,
    alcohol: false,
    obstructs_public_way: null,
    status: "draft",
    created_at: "2026-07-24T00:00:00.000Z",
  };

  it("says it is loading before the event arrives", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    renderForm("event-9");
    expect(screen.getByRole("status").textContent).toBe("Loading your event…");
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });

  it("fills the questionnaire in from the stored answers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { event: storedEvent, warnings: [], plan_stale: false }),
    );
    renderForm("event-9");

    await waitFor(() => expect(screen.getByText(/Saved as revision 4/)).toBeDefined());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/api/events/event-9");
    expect(screen.getByRole("heading").textContent).toBe("Edit your event");
    expect(document.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(
      "Prospect Park Community Day",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="capacity"]')?.value).toBe("400");
    expect(
      document.querySelector<HTMLInputElement>('input[name="location_type"][value="park"]')
        ?.checked,
    ).toBe(true);
    // Columns the form does not ask about are left where they are.
    expect(document.querySelector('input[name="status"]')).toBeNull();
    // A park is not asked the SAPO questions, so the null column stays unanswered.
    expect(questionsOnScreen()).not.toContain("Obstructs public way");
  });

  it("reloads both assembly-document answers for editing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        event: {
          ...storedEvent,
          location_type: "private_venue",
          headcount: 75,
          venue_paco_covers_exact_event: "no",
          venue_fdny_pa_permit_current_for_event_space: "unknown",
        },
        warnings: [],
        plan_stale: false,
      }),
    );
    renderForm("event-9");

    await waitFor(() => expect(screen.getByText(/Saved as revision 4/)).toBeDefined());
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="venue_paco_covers_exact_event"][value="no"]',
      )?.checked,
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="venue_fdny_pa_permit_current_for_event_space"][value="unknown"]',
      )?.checked,
    ).toBe(true);
  });

  it("edits the loaded event rather than creating a second one", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { event: storedEvent, warnings: [], plan_stale: false }),
    );
    const user = renderForm("event-9");
    await waitFor(() => expect(screen.getByText(/Saved as revision 4/)).toBeDefined());

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, savedEvent({ id: "event-9", revision_counter: 5 })),
    );
    await fillField(user, "headcount", "151");
    await save(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/events/event-9");
    expect(init.method).toBe("PATCH");
    expect(requestBody(fetchMock, 1).headcount).toBe(151);
  });

  it("carries a standing plan-stale flag through the load", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { event: storedEvent, warnings: [], plan_stale: true }),
    );
    renderForm("event-9");
    await waitFor(() => expect(screen.getByText(/out of date/)).toBeDefined());
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeDefined();
  });

  it("drops a load that lands after the form has gone", async () => {
    let releaseEvent: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (releaseEvent = resolve)),
    );
    renderForm("event-9");
    cleanup();

    releaseEvent(jsonResponse(200, { event: storedEvent, plan_stale: false }));
    // Nothing to assert on screen: the point is that the late answer updates no state
    // and the test does not blow up on an unmounted component.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refuses to offer a save when the event could not be loaded", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "event not found" }));
    renderForm("missing");

    expect((await screen.findByRole("alert")).textContent).toBe("event not found");
    // Saving here would create a second event instead of editing the one asked for.
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});

describe("clearing an optional answer on an edit", () => {
  it("sends a blank venue name and capacity as explicit nulls", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        event: {
          id: "event-9",
          revision_counter: 4,
          name: "Prospect Park Community Day",
          location_name: "Long Meadow",
          capacity: 400,
          borough: "brooklyn",
          location_type: "park",
          headcount: 150,
          event_date: "2026-09-16",
          event_open_to_public: "yes",
          food_present: false,
          selling_anything: false,
          amplified_sound: true,
          structure_types: ["none"],
          open_flame_or_cooking: ["none"],
          generator_present: false,
          alcohol: false,
        },
        warnings: [],
        plan_stale: false,
      }),
    );
    const user = renderForm("event-9");
    await waitFor(() => expect(screen.getByText(/Saved as revision 4/)).toBeDefined());

    await user.clear(document.querySelector<HTMLInputElement>('input[name="location_name"]')!);
    await user.clear(document.querySelector<HTMLInputElement>('input[name="capacity"]')!);
    await save(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // Omitting them would leave the stored values in place: the api merges omissions
    // with the stored row, so a cleared optional has to be said out loud.
    const edit = requestBody(fetchMock, 1);
    expect(edit).toHaveProperty("location_name", null);
    expect(edit).toHaveProperty("capacity", null);
  });
});

describe("NYC park-name suggestions", () => {
  const parksResponse = (parkName: string, locationId: string) =>
    jsonResponse(200, {
      status: "SUCCESS",
      spaces: [
        {
          locationId,
          parkName,
          borough: "B",
          type: "Whole Park",
          acres: "1",
        },
      ],
    });

  it("appears only for a park with a borough and selects a result into location_name", async () => {
    const user = renderForm();
    expect(screen.queryByRole("button", { name: "Search NYC Parks" })).toBeNull();

    await chooseOption(user, "borough", "brooklyn");
    expect(screen.queryByRole("button", { name: "Search NYC Parks" })).toBeNull();
    await chooseOption(user, "location_type", "park");
    const search = screen.getByRole("button", { name: "Search NYC Parks" });
    expect(search.hasAttribute("disabled")).toBe(true);

    await fillField(user, "location_name", "Prospect");
    fetchMock.mockResolvedValueOnce(parksResponse("Prospect Park", "B073-EVENTAREA-1"));
    await user.click(search);

    const suggestion = await screen.findByRole("button", { name: "Prospect Park" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.example.com/api/permits/nyc/discover?borough=B&name=Prospect&limit=20",
    );
    expect(init.credentials).toBe("include");

    await user.click(suggestion);
    expect(document.querySelector<HTMLInputElement>('input[name="location_name"]')?.value).toBe(
      "Prospect Park",
    );
  });

  it("ignores an older search response after the location name changes", async () => {
    const releases: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(resolve);
        }),
    );
    const user = renderForm();
    await chooseOption(user, "borough", "brooklyn");
    await chooseOption(user, "location_type", "park");

    await fillField(user, "location_name", "Meadow");
    await user.click(screen.getByRole("button", { name: "Search NYC Parks" }));
    await waitFor(() => expect(releases).toHaveLength(1));

    await fillField(user, "location_name", "Lake");
    await user.click(screen.getByRole("button", { name: "Search NYC Parks" }));
    await waitFor(() => expect(releases).toHaveLength(2));
    expect(((fetchMock.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal).aborted).toBe(
      true,
    );

    releases[1]?.(parksResponse("Prospect Lake", "B073-EVENTAREA-2"));
    expect(await screen.findByRole("button", { name: "Prospect Lake" })).toBeDefined();

    releases[0]?.(parksResponse("Long Meadow", "B073-EVENTAREA-3"));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: "Long Meadow" })).toBeNull();
    expect(screen.getByRole("button", { name: "Prospect Lake" })).toBeDefined();
  });

  it("keeps manual location saving available when discovery fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: "unavailable" }));
    const user = renderForm();
    await answerParkEvent(user);
    await fillField(user, "location_name", "My neighborhood green");
    await user.click(screen.getByRole("button", { name: "Search NYC Parks" }));

    expect(
      await screen.findByText(/You can still enter and save the location name manually/),
    ).toBeDefined();
    await save(user);

    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    expect(requestBody(fetchMock, 1).location_name).toBe("My neighborhood green");
  });

  it("explains the search limit without restricting manual location entry", async () => {
    const user = renderForm();
    await answerParkEvent(user);
    const manualLocation = "x".repeat(81);
    await fillField(user, "location_name", manualLocation);

    expect(
      screen.getByText(
        "Park searches must be 80 characters or fewer. You can still save this location name manually.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Search NYC Parks" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await save(user);
    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    expect(requestBody(fetchMock).location_name).toBe(manualLocation);
  });
});

describe("inline warnings render the published text (spec #4, #5)", () => {
  it("warns that a selling block party conflicts with eligibility", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "street");
    await chooseOption(user, "obstructs_public_way", "yes");
    await chooseOption(user, "sapo_event_type", "block_party");
    expect(screen.queryByRole("status")).toBeNull();

    await chooseOption(user, "selling_anything", "true");
    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain(contract.blockPartyEligibilityNotice.text);
    expect(warning.textContent).toContain("SAPO-BLOCK-PARTY-ELIG-001");
    expect(warning.textContent).toContain("SOURCE_CONFIRMED");
  });

  it("renders the coverage warning for alcohol in public space with its gap status", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "park");
    await chooseOption(user, "alcohol", "true");

    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain(contract.alcoholInPublicSpaceNotice.text);
    expect(warning.textContent).toContain("ADV-ALCOHOL-PUBLIC-001");
    // The status must stay visible: an uncovered area may not read as an evaluated one.
    expect(warning.textContent).toContain("COVERAGE_GAP");
  });

  it("does not warn about alcohol at a private venue", async () => {
    const user = renderForm();
    await chooseOption(user, "location_type", "private_venue");
    await chooseOption(user, "alcohol", "true");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("saving and per-field errors", () => {
  it("posts the intake and reports the revision it was saved as", async () => {
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);

    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/events");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Promote public page" }).getAttribute("href")).toBe(
      "/events/event-1/promote",
    );
    expect(screen.getByRole("link", { name: "Guest list" }).getAttribute("href")).toBe(
      "/events/event-1/guests",
    );
  });

  it("shows the api's message against the field it belongs to", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        errors: [
          { field: "headcount", code: "must_be_positive", message: "headcount must be at least 1" },
        ],
        warnings: [],
      }),
    );
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("headcount must be at least 1");
    const question = screen.getByRole("group", { name: /Headcount/ });
    expect(within(question).getByRole("alert")).toBeDefined();
    const headcount = screen.getByRole("spinbutton", { name: "Headcount" });
    expect(headcount.getAttribute("aria-invalid")).toBe("true");
    expect(headcount.getAttribute("aria-describedby")).toContain("intake-headcount-error");
    await waitFor(() => expect(document.activeElement).toBe(headcount));
  });

  it("shows an error the form has no field for at the form level", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        errors: [
          {
            field: "attendee_wifi",
            code: "unknown_field",
            message: "attendee_wifi is not an intake field",
          },
        ],
        warnings: [],
      }),
    );
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "attendee_wifi is not an intake field",
    );
  });

  it("reports a refusal that carries no field errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);

    expect((await screen.findByRole("alert")).textContent).toBe("The event could not be saved.");
  });

  it("reports an unreachable api", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);

    expect((await screen.findByRole("alert")).textContent).toBe("The API could not be reached.");
  });

  it("clears the field errors once the next save succeeds", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        errors: [
          { field: "headcount", code: "must_be_positive", message: "headcount must be at least 1" },
        ],
        warnings: [],
      }),
    );
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);
    expect(await screen.findByRole("alert")).toBeDefined();

    await fillField(user, "headcount", "150");
    await save(user);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("editing a saved event", () => {
  /** A selling street event, classified all the way down to its SAPO size. */
  const answerSellingStreetEvent = async (
    user: ReturnType<typeof userEvent.setup>,
    sapoEventType = "street_event",
  ) => {
    await fillField(user, "name", "Bushwick Street Activation");
    await chooseOption(user, "borough", "brooklyn");
    await chooseOption(user, "location_type", "street");
    await chooseOption(user, "obstructs_public_way", "yes");
    await chooseOption(user, "sapo_event_type", sapoEventType);
    if (sapoEventType === "street_event") await chooseOption(user, "street_event_size", "large");
    if (sapoEventType === "block_party") await chooseOption(user, "has_amusement_ride", "false");
    await fillField(user, "headcount", "75");
    await fillField(user, "event_date", "2026-08-26");
    await chooseOption(user, "event_open_to_public", "yes");
    await chooseOption(user, "food_present", "false");
    await chooseOption(user, "selling_anything", "true");
    await chooseOption(user, "amplified_sound", "true");
    await chooseOption(user, "structure_types", "none");
    await chooseOption(user, "open_flame_or_cooking", "none");
    await chooseOption(user, "generator_present", "false");
    await chooseOption(user, "alcohol", "false");
  };

  it("clears the answers a rescope hides, so the edit can be saved", async () => {
    const user = renderForm();
    await answerSellingStreetEvent(user);
    await save(user);
    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    expect(requestBody(fetchMock).street_event_size).toBe("large");

    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) =>
      echoSavedEvent(200, init, { revision_counter: 2 }),
    );
    await chooseOption(user, "location_type", "park");
    expect(questionsOnScreen()).not.toContain("Street event size");
    await save(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/events/event-1");
    expect(init.method).toBe("PATCH");
    // The hidden answers go out as explicit nulls rather than being left behind.
    const edit = requestBody(fetchMock, 1);
    expect(edit.location_type).toBe("park");
    expect(edit.obstructs_public_way).toBeNull();
    expect(edit.sapo_event_type).toBeNull();
    expect(edit.street_event_size).toBeNull();
    expect(edit.headcount).toBe(75);
  });

  it("drops a warning as soon as its answer stops applying, before any save", async () => {
    // A published regulatory notice must not stand against a scope the event no longer
    // has. The organizer sees the rescope take effect immediately; waiting for a
    // successful save would leave a block-party notice on a park event in between.
    const user = renderForm();
    await answerSellingStreetEvent(user, "block_party");
    expect(screen.getByRole("status").textContent).toContain(
      contract.blockPartyEligibilityNotice.text,
    );

    await chooseOption(user, "location_type", "park");
    expect(questionsOnScreen()).not.toContain("Sapo event type");
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a warning whose answers the save cleared", async () => {
    // The stored row is what the plan will be built from, so a warning about answers
    // the row no longer holds is a false alarm the organizer cannot act on.
    const user = renderForm();
    await answerSellingStreetEvent(user, "block_party");
    await save(user);
    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    expect(screen.getByRole("status").textContent).toContain(
      contract.blockPartyEligibilityNotice.text,
    );

    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) =>
      echoSavedEvent(200, init, { revision_counter: 2 }),
    );
    await chooseOption(user, "location_type", "park");
    await save(user);

    await waitFor(() => expect(screen.getByText(/Saved as revision 2/)).toBeDefined());
    expect(requestBody(fetchMock, 1).sapo_event_type).toBeNull();
    expect(screen.queryByText(contract.blockPartyEligibilityNotice.text)).toBeNull();
  });

  it("keeps what was typed while the save was in flight", async () => {
    // The rebuild from the stored row must not roll back edits the organizer made
    // after pressing Save: those answers are newer than the response.
    const user = renderForm();
    await answerParkEvent(user);
    await fillField(user, "capacity", "400");

    let releaseSave: (response: Response) => void = () => {};
    let submitted: RequestInit | undefined;
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          submitted = init;
          releaseSave = resolve;
        }),
    );
    await save(user);

    // Still editing while the request is open: one answer changed, one cleared.
    await fillField(user, "headcount", "175");
    await fillField(user, "location_name", "Long Meadow");
    await user.clear(document.querySelector<HTMLInputElement>('input[name="capacity"]')!);
    releaseSave(echoSavedEvent(201, submitted as RequestInit));

    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    expect(document.querySelector<HTMLInputElement>('input[name="headcount"]')?.value).toBe("175");
    expect(document.querySelector<HTMLInputElement>('input[name="location_name"]')?.value).toBe(
      "Long Meadow",
    );
    // The response carried capacity 400; clearing it after the submission wins.
    expect(document.querySelector<HTMLInputElement>('input[name="capacity"]')?.value).toBe("");

    // And the next save sends the newer answers, not the ones the response carried.
    await save(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestBody(fetchMock, 1).headcount).toBe(175);
    expect(requestBody(fetchMock, 1).location_name).toBe("Long Meadow");
    expect(requestBody(fetchMock, 1).capacity).toBeNull();
  });

  it("still takes the stored value for answers left alone during the save", async () => {
    const user = renderForm();
    await answerSellingStreetEvent(user);

    let releaseSave: (response: Response) => void = () => {};
    let submitted: RequestInit | undefined;
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          submitted = init;
          releaseSave = resolve;
        }),
    );
    await save(user);
    await fillField(user, "headcount", "80");

    // The api normalises an answer the organizer did not touch during the request.
    releaseSave(
      echoSavedEvent(201, submitted as RequestInit, { name: "Bushwick Street Activation (SAPO)" }),
    );

    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    expect(document.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe(
      "Bushwick Street Activation (SAPO)",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="headcount"]')?.value).toBe("80");
  });

  it("shows a re-revealed question as cleared, not as it was before the save", async () => {
    const user = renderForm();
    await answerSellingStreetEvent(user);
    await save(user);
    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());

    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) =>
      echoSavedEvent(200, init, { revision_counter: 2 }),
    );
    await chooseOption(user, "location_type", "park");
    await save(user);
    await waitFor(() => expect(screen.getByText(/Saved as revision 2/)).toBeDefined());

    // Back to a street event: the SAPO questions return unanswered, because the row
    // they were cleared from is the answer of record.
    await chooseOption(user, "location_type", "street");
    expect(
      document.querySelector<HTMLInputElement>('input[name="obstructs_public_way"][value="yes"]')
        ?.checked,
    ).toBe(false);
    await chooseOption(user, "obstructs_public_way", "yes");
    await chooseOption(user, "sapo_event_type", "street_event");
    expect(
      document.querySelector<HTMLInputElement>('input[name="street_event_size"][value="large"]')
        ?.checked,
    ).toBe(false);

    // And the next edit cannot resurrect the value the database cleared.
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) =>
      echoSavedEvent(200, init, { revision_counter: 3 }),
    );
    await save(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestBody(fetchMock, 2).street_event_size).toBeNull();
  });
});

describe("the regenerate control (spec #8)", () => {
  const saveThenStalePlan = async () => {
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) =>
      jsonResponse(200, {
        ...savedEvent({ ...JSON.parse(String(init.body)), revision_counter: 2 }),
        plan_stale: true,
      }),
    );
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);
    await waitFor(() => expect(screen.getByText(/out of date/)).toBeDefined());
    return user;
  };

  it("stays hidden while the plan is current", async () => {
    const user = renderForm();
    await answerParkEvent(user);
    await save(user);
    await waitFor(() => expect(screen.getByText(/Saved as revision 1/)).toBeDefined());
    expect(screen.queryByRole("button", { name: /Regenerate/ })).toBeNull();
  });

  it("offers one enabled click, then reports the regenerated revision", async () => {
    const user = await saveThenStalePlan();
    const button = screen.getByRole("button", { name: "Regenerate plan" });
    expect(button.hasAttribute("disabled")).toBe(false);

    let releasePlan: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (releasePlan = resolve)),
    );
    await user.click(button);

    // In flight: the control names what it is doing and refuses a second click.
    const inFlight = screen.getByRole("button", { name: "Regenerating plan…" });
    expect(inFlight.hasAttribute("disabled")).toBe(true);

    releasePlan(jsonResponse(201, { verdict: "feasible" }));
    await waitFor(() => expect(screen.getByText(/Plan regenerated for revision 2/)).toBeDefined());
    expect(screen.queryByText(/out of date/)).toBeNull();

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/api/events/event-1/plan");
    expect(init.method).toBe("POST");
  });

  it("ignores a plan that finishes after the event has moved on", async () => {
    // The race: regeneration for revision 2 is in flight, the organizer saves revision
    // 3, and the older plan lands afterwards. Clearing the stale state then would hide
    // the warning and leave no button for the revision actually on screen.
    const user = await saveThenStalePlan();

    let releasePlan: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (releasePlan = resolve)),
    );
    await user.click(screen.getByRole("button", { name: "Regenerate plan" }));

    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) =>
      jsonResponse(200, {
        ...savedEvent({ ...JSON.parse(String(init.body)), revision_counter: 3 }),
        plan_stale: true,
      }),
    );
    await fillField(user, "headcount", "151");
    await save(user);
    await waitFor(() => expect(screen.getByText(/Saved as revision 3/)).toBeDefined());

    releasePlan(jsonResponse(201, { verdict: "feasible", eventRevision: 2 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regenerate plan" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect(screen.getByText(/out of date/)).toBeDefined();
    expect(screen.queryByText(/Plan regenerated/)).toBeNull();
  });

  it("ignores a plan that names a revision other than the one on screen", async () => {
    const user = await saveThenStalePlan();
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { verdict: "feasible", eventRevision: 1 }));
    await user.click(screen.getByRole("button", { name: "Regenerate plan" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Regenerate plan" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect(screen.getByText(/out of date/)).toBeDefined();
    expect(screen.queryByText(/Plan regenerated/)).toBeNull();
  });

  it("accepts a plan that does not name a revision, since the event has not moved", async () => {
    // The plan endpoint is F-201's and may not report the revision. When the event has
    // not moved while the call was in flight, that is still this revision's plan.
    const user = await saveThenStalePlan();
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { verdict: "feasible" }));
    await user.click(screen.getByRole("button", { name: "Regenerate plan" }));

    await waitFor(() => expect(screen.getByText(/Plan regenerated for revision 2/)).toBeDefined());
  });

  it("keeps the stale banner and shows why when regeneration fails", async () => {
    const user = await saveThenStalePlan();
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    await user.click(screen.getByRole("button", { name: "Regenerate plan" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The plan could not be regenerated (HTTP 404).",
    );
    // The plan is still stale: a failed regeneration must not read as a fresh plan.
    expect(screen.getByText(/out of date/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Regenerate plan" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});
