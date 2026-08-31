// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChecklistPage from "../events/[id]/checklist/page";
import PlanPage from "../events/[id]/plan/page";
import { publishedRulesFileIn } from "../_lib/rules-file";
import { ChecklistView } from "./checklist-view";
import { NOT_COVERED_BY_RULESET } from "../_lib/verification-copy";
import { CANDIDATE_HEADING } from "../plan/plan-line";
import { CONFIRM_WITH_AGENCY } from "@pop-engine/engine";
import {
  ALCOHOL_ADVISORY,
  checklistBody,
  citationOf,
  feeOf,
  INSURANCE,
  nameOf,
  NOISE_ADVISORY,
  noteTextOf,
  PARKS_TUA,
  planContext,
  portalNameOf,
  portalUrlOf,
  PUBLISHED_SNAPSHOT,
  SOUND,
  SOUND_DEPENDENCY,
  STREET_LARGE,
  STREET_MEDIUM,
  trackedItem,
} from "./checklist-fixtures";

const API = "https://api.example.com";
const EVENT = "event-1";

type Route = { method: string; url: string };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubApi(routes: Record<string, () => Response>) {
  const calls: Route[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const route = Object.entries(routes).find(
      ([key]) => key === `${method} ${url.slice(API.length)}`,
    );
    if (route === undefined && `${method} ${url.slice(API.length)}` === GET_META) {
      return jsonResponse(200, {
        ruleset_version: PUBLISHED_SNAPSHOT.rulesetVersion,
        snapshot_date: PUBLISHED_SNAPSHOT.snapshotDate,
      });
    }
    if (route === undefined) throw new Error(`unstubbed request: ${method} ${url}`);
    return route[1]();
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const GET_CHECKLIST = `GET /api/events/${EVENT}/checklist`;
const GET_META = "GET /api/rules/meta";
const POST_CHECKLIST = `POST /api/events/${EVENT}/checklist`;
const itemRoute = (method: string, ruleId: string, suffix = "") =>
  `${method} /api/checklist-items/item-${ruleId}${suffix}`;

const checklistReads = (calls: Route[]): Route[] =>
  calls.filter((call) => call.method === "GET" && call.url.endsWith("/checklist"));

const checklistOf = (overrides: Record<string, unknown>) => () =>
  jsonResponse(200, checklistBody(overrides));

const rollupOf = (counts: Record<string, number>) => ({
  not_started: 0,
  in_progress: 0,
  submitted: 0,
  approved: 0,
  rejected: 0,
  ...counts,
});

const renderView = async () => {
  render(<ChecklistView apiBaseUrl={API} eventId={EVENT} />);
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
};

const rowFor = (ruleId: string) => screen.getByRole("article", { name: nameOf(ruleId) });

const candidateRow = () => screen.getByRole("article", { name: CANDIDATE_HEADING });

const expandRow = async (row: HTMLElement): Promise<HTMLElement> => {
  const toggle = within(row).queryByRole("button", { name: /^Details for/ });
  if (toggle !== null) await userEvent.click(toggle);
  return row;
};

const expandedCandidateRow = async (): Promise<HTMLElement> => expandRow(candidateRow());

const expandedRowFor = async (ruleId: string): Promise<HTMLElement> => {
  const row = rowFor(ruleId);
  const toggle = within(row).queryByRole("button", { name: /^Details for/ });
  if (toggle !== null) await userEvent.click(toggle);
  return row;
};

const badgeOf = (row: HTMLElement): string | undefined =>
  row.querySelector(".check-item__status")?.textContent ?? undefined;

function stubWindowOpen(opened: { closed?: boolean } | null = { closed: false }) {
  const target =
    opened === null
      ? null
      : { location: { href: "" }, closed: opened.closed ?? false, opener: {}, close: vi.fn() };
  const open = vi.fn(() => target);
  vi.stubGlobal("open", open);
  return { open, target };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AC 1 · one click converts the latest plan into a checklist", () => {
  it("offers conversion when no checklist exists and installs what the api created", async () => {
    let current = checklistBody({ created: false });
    const calls = stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [POST_CHECKLIST]: () => {
        current = checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] });
        return jsonResponse(201, current);
      },
    });
    await renderView();

    await userEvent.click(
      screen.getByRole("button", { name: "Create the checklist from this plan" }),
    );

    expect(await screen.findByRole("heading", { name: nameOf(STREET_MEDIUM) })).toBeDefined();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("keeps each row's link to its rule, deadline, citation and portal", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { latestApplyDate: "2026-08-01" })],
      }),
    });
    await renderView();

    const row = await expandedRowFor(STREET_MEDIUM);
    expect(row.textContent).not.toContain(STREET_MEDIUM);
    expect(within(row).getByText(/apply by 2026-08-01/)).toBeDefined();
    expect(within(row).getByText(citationOf(STREET_MEDIUM))).toBeDefined();
    expect(within(row).getByText(feeOf(STREET_MEDIUM) as string)).toBeDefined();
    expect(within(row).getByText(/apply at/)).toBeDefined();
    expect(
      within(row)
        .getByRole("link", { name: portalNameOf(STREET_MEDIUM) as string })
        .getAttribute("href"),
    ).toBe(portalUrlOf(STREET_MEDIUM));
    expect(
      within(row)
        .getByRole("link", { name: portalNameOf(STREET_MEDIUM) as string })
        .getAttribute("target"),
    ).toBe("_blank");
  });

  it("sends the organizer to the plan view when there is no plan to convert", async () => {
    stubApi({
      [GET_CHECKLIST]: () => jsonResponse(404, { error: "no plan generated for event event-1" }),
    });
    await renderView();

    expect(screen.getByRole("alert").textContent).toBe("no plan generated for event event-1");
    expect(
      screen.getByRole("link", { name: "Generate the permit plan first" }).getAttribute("href"),
    ).toBe(`/events/${EVENT}/plan`);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not offer conversion when the checklist could not be read", async () => {
    stubApi({ [GET_CHECKLIST]: () => jsonResponse(500, {}) });
    await renderView();

    expect(screen.getByRole("alert").textContent).toBe(
      "The checklist could not be loaded (HTTP 500).",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("refuses conversion while the plan is behind the event, and says why", async () => {
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: false, planStale: true }) });
    await renderView();

    expect(screen.getByRole("alert").textContent).toContain("has been edited since this plan");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reports a conversion the api refused, leaving the page as it was", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: false }),
      [POST_CHECKLIST]: () => jsonResponse(409, { error: "regenerate the plan first" }),
    });
    await renderView();

    await userEvent.click(screen.getByRole("button"));

    expect((await screen.findByRole("alert")).textContent).toBe("regenerate the plan first");
    expect(
      screen.getByRole("button", { name: "Create the checklist from this plan" }),
    ).toBeDefined();
  });
});

describe("AC 2 · statuses, any transition, and the api's rollup", () => {
  it("offers every status from every status, because agencies are messy", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { status: "approved" })],
      }),
    });
    await renderView();

    const select = screen.getByRole("combobox", { name: `Status for ${nameOf(STREET_MEDIUM)}` });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["not started", "in progress", "submitted", "approved", "rejected"]);
    expect((select as HTMLSelectElement).value).toBe("approved");
  });

  it("saves a backwards transition and shows the reloaded row and count", async () => {
    let current = checklistBody({
      created: true,
      statusRollup: rollupOf({ approved: 1 }),
      items: [trackedItem(STREET_MEDIUM, { status: "approved" })],
    });
    const calls = stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [itemRoute("PATCH", STREET_MEDIUM)]: () => {
        current = checklistBody({
          created: true,
          statusRollup: rollupOf({ in_progress: 1 }),
          items: [trackedItem(STREET_MEDIUM, { status: "in_progress" })],
        });
        return jsonResponse(200, {
          id: `item-${STREET_MEDIUM}`,
          status: "in_progress",
          notes: null,
        });
      },
    });
    await renderView();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: `Status for ${nameOf(STREET_MEDIUM)}` }),
      "in_progress",
    );

    await waitFor(() => expect(badgeOf(rowFor(STREET_MEDIUM))).toBe("in progress"));
    expect(document.querySelector(".checklist__rollup")?.textContent).toBe("1 in progress");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(checklistReads(calls)).toHaveLength(2);
  });

  it("renders the counts the api sent, not a count of its own", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        statusRollup: rollupOf({ submitted: 2, approved: 1 }),
        items: [trackedItem(STREET_MEDIUM, { status: "not_started" })],
      }),
    });
    await renderView();

    expect(document.querySelector(".checklist__rollup")?.textContent).toBe(
      "2 submitted · 1 approved",
    );
  });

  it("counts retained rows separately, beside the rollup that excludes them", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        statusRollup: rollupOf({ submitted: 1, approved: 1 }),
        items: [
          trackedItem(STREET_MEDIUM, { status: "submitted" }),
          trackedItem(SOUND, { status: "approved" }),
          trackedItem(STREET_LARGE, { status: "approved", struckThrough: true }),
        ],
      }),
    });
    await renderView();

    expect(document.querySelector(".checklist__rollup")?.textContent).toBe(
      "1 submitted · 1 approved · plus 1 retained from an earlier plan, not counted above",
    );
  });

  it("says so plainly when the current plan has no trackable rows left", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        statusRollup: rollupOf({}),
        items: [trackedItem(STREET_LARGE, { struckThrough: true })],
      }),
    });
    await renderView();

    expect(document.querySelector(".checklist__rollup")?.textContent).toBe(
      "No trackable requirements in the current plan. · plus 1 retained from an earlier plan, not counted above",
    );
  });

  it("leaves the row's status alone when the update fails, and says so", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { status: "not_started" })],
      }),
      [itemRoute("PATCH", STREET_MEDIUM)]: () => jsonResponse(500, {}),
    });
    await renderView();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: `Status for ${nameOf(STREET_MEDIUM)}` }),
      "submitted",
    );

    const row = rowFor(STREET_MEDIUM);
    expect((await within(row).findByRole("alert")).textContent).toContain("HTTP 500");
    expect(badgeOf(row)).toBe("not started");
  });

  it("says the change was saved when only the reload failed", async () => {
    let reloads = 0;
    stubApi({
      [GET_CHECKLIST]: () => {
        reloads += 1;
        return reloads === 1
          ? jsonResponse(200, checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] }))
          : jsonResponse(500, {});
      },
      [itemRoute("PATCH", STREET_MEDIUM)]: () =>
        jsonResponse(200, { id: `item-${STREET_MEDIUM}`, status: "submitted", notes: null }),
    });
    await renderView();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: `Status for ${nameOf(STREET_MEDIUM)}` }),
      "submitted",
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The change was saved, but the checklist could not be reloaded: The checklist could not be loaded (HTTP 500).",
    );
  });
});

describe("AC 3 · documents upload and download", () => {
  const pdf = () => new File([new Uint8Array(8)], "permit.pdf", { type: "application/pdf" });

  it("uploads a chosen file and lists it on the reloaded item", async () => {
    let current = checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] });
    stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [itemRoute("POST", STREET_MEDIUM, "/documents")]: () => {
        current = checklistBody({
          created: true,
          items: [
            trackedItem(STREET_MEDIUM, {
              documents: [{ id: "doc-1", filename: "permit.pdf" }],
            }),
          ],
        });
        return jsonResponse(201, { id: "doc-1", filename: "permit.pdf" });
      },
    });
    await renderView();

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      pdf(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("permit.pdf")).toBeDefined();
  });

  it("opens the tab on the click and navigates it to the signed URL", async () => {
    const { open, target } = stubWindowOpen();
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, { documents: [{ id: "doc-1", filename: "permit.pdf" }] }),
        ],
      }),
      "GET /api/documents/doc-1/url": () =>
        jsonResponse(200, { url: "https://storage.example.com/signed", expiresInSeconds: 300 }),
    });
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(target?.location.href).toBe("https://storage.example.com/signed"));
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(target?.opener).toBeNull();
  });

  it("says the download was blocked rather than reporting a success that did nothing", async () => {
    stubWindowOpen(null);
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, { documents: [{ id: "doc-1", filename: "permit.pdf" }] }),
        ],
      }),
      "GET /api/documents/doc-1/url": () =>
        jsonResponse(200, { url: "https://storage.example.com/signed", expiresInSeconds: 300 }),
    });
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: "Download" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The download was blocked by the browser. Allow pop-ups for this site and try again.",
    );
  });

  it("says so too when the organizer closed the tab before the URL arrived", async () => {
    stubWindowOpen({ closed: true });
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, { documents: [{ id: "doc-1", filename: "permit.pdf" }] }),
        ],
      }),
      "GET /api/documents/doc-1/url": () =>
        jsonResponse(200, { url: "https://storage.example.com/signed", expiresInSeconds: 300 }),
    });
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: "Download" }));

    expect((await screen.findByRole("alert")).textContent).toContain("blocked by the browser");
  });

  it("closes the tab it opened when the link could not be read", async () => {
    const { target } = stubWindowOpen();
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, { documents: [{ id: "doc-1", filename: "permit.pdf" }] }),
        ],
      }),
      "GET /api/documents/doc-1/url": () =>
        jsonResponse(404, { error: "document doc-1 not found" }),
    });
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: "Download" }));

    expect((await screen.findByRole("alert")).textContent).toBe("document doc-1 not found");
    expect(target?.close).toHaveBeenCalled();
    expect(target?.location.href).toBe("");
  });

  it("keeps the item and the chosen file when the api stored nothing", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { status: "submitted" })],
      }),
      [itemRoute("POST", STREET_MEDIUM, "/documents")]: () =>
        jsonResponse(503, { error: "document storage is unavailable", retryable: true }),
    });
    await renderView();

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      pdf(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const row = rowFor(STREET_MEDIUM);
    expect((await within(row).findByRole("alert")).textContent).toBe(
      "document storage is unavailable Nothing was stored, so the file is still selected.",
    );
    expect(badgeOf(row)).toBe("submitted");
    expect(within(row).queryByRole("button", { name: "Download" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Upload" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("refreshes the checklist and keeps the file when an upload never completed", async () => {
    let attempts = 0;
    const calls = stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
      [itemRoute("POST", STREET_MEDIUM, "/documents")]: () => {
        attempts += 1;
        throw new TypeError("network down");
      },
    });
    await renderView();

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      pdf(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const row = rowFor(STREET_MEDIUM);
    expect((await within(row).findByRole("alert")).textContent).toBe(
      "The connection did not complete, so whether this document was stored is not known. " +
        "The checklist has been refreshed; it may not show an upload that is still finishing. " +
        "The file is still selected — uploading it again is safe, because the same file cannot be " +
        "stored twice on this item.",
    );
    expect(checklistReads(calls)).toHaveLength(2);
    expect(within(row).getByRole("button", { name: "Upload" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(attempts).toBe(1);
  });

  it("clears the file when the upload landed but its answer was unreadable", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
      [itemRoute("POST", STREET_MEDIUM, "/documents")]: () => jsonResponse(201, { id: 7 }),
    });
    await renderView();

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      pdf(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The document was uploaded, but the API returned a response this page cannot read.",
    );
    expect(screen.getByRole("button", { name: "Upload" }).hasAttribute("disabled")).toBe(true);
  });

  it("does not invite a retry when the upload landed and the reload did not", async () => {
    let reloads = 0;
    stubApi({
      [GET_CHECKLIST]: () => {
        reloads += 1;
        return reloads === 1
          ? jsonResponse(200, checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] }))
          : jsonResponse(500, {});
      },
      [itemRoute("POST", STREET_MEDIUM, "/documents")]: () =>
        jsonResponse(201, { id: "doc-1", filename: "permit.pdf" }),
    });
    await renderView();

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      pdf(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The change was saved, but the checklist could not be");
    expect(alert.textContent).not.toContain("try the upload again");
  });

  it("does not invite a retry for a refusal that would be repeated identically", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
      [itemRoute("POST", STREET_MEDIUM, "/documents")]: () =>
        jsonResponse(413, { error: "document must be 10485760 bytes or smaller" }),
    });
    await renderView();

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      pdf(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "document must be 10485760 bytes or smaller Nothing was stored, so the file is still selected.",
    );
  });

  it("refuses a type the api would refuse, without sending it", async () => {
    const calls = stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
    });
    await renderView();

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      new File(["x"], "notes.txt", { type: "text/plain" }),
      { applyAccept: false },
    );

    expect(screen.getByRole("alert").textContent).toBe("Documents must be a PDF, PNG or JPG.");
    expect(screen.getByRole("button", { name: "Upload" }).hasAttribute("disabled")).toBe(true);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("clears the rejection when the file picker is emptied", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
    });
    await renderView();

    const picker = screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`);
    await userEvent.upload(picker, new File(["x"], "notes.txt", { type: "text/plain" }), {
      applyAccept: false,
    });
    await userEvent.upload(picker, []);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AC 4 · notes persist per item", () => {
  it("saves a note and shows what came back on the reloaded row", async () => {
    let current = checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] });
    const calls = stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [itemRoute("PATCH", STREET_MEDIUM)]: () => {
        current = checklistBody({
          created: true,
          items: [trackedItem(STREET_MEDIUM, { notes: "called SAPO Tuesday" })],
        });
        return jsonResponse(200, {
          id: `item-${STREET_MEDIUM}`,
          status: "not_started",
          notes: "called SAPO Tuesday",
        });
      },
    });
    await renderView();

    const notes = screen.getByRole("textbox", { name: `Notes for ${nameOf(STREET_MEDIUM)}` });
    await userEvent.type(notes, "called SAPO Tuesday");
    await userEvent.click(screen.getByRole("button", { name: "Save notes" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save notes" }).hasAttribute("disabled")).toBe(
        true,
      ),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: `Notes for ${nameOf(STREET_MEDIUM)}`,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("called SAPO Tuesday");
    expect(calls.some((call) => call.method === "PATCH")).toBe(true);
  });

  it("starts from the note already stored on the item", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { notes: "waiting on the precinct" })],
      }),
    });
    await renderView();

    expect(
      (
        screen.getByRole("textbox", {
          name: `Notes for ${nameOf(STREET_MEDIUM)}`,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("waiting on the precinct");
  });

  it("reports a note that could not be saved", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
      [itemRoute("PATCH", STREET_MEDIUM)]: () =>
        jsonResponse(404, { error: "checklist item not found" }),
    });
    await renderView();

    await userEvent.type(
      screen.getByRole("textbox", { name: `Notes for ${nameOf(STREET_MEDIUM)}` }),
      "x",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save notes" }));

    expect((await screen.findByRole("alert")).textContent).toBe("checklist item not found");
  });
});

describe("AC 5 · deadline context lives where the work happens", () => {
  it("shows the latest apply date, and the apply-after date when the item is gated", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-01",
            applyAfterDate: "2026-07-20",
            deadlineStatus: "deadline_approaching",
          }),
        ],
      }),
    });
    await renderView();

    const row = rowFor(STREET_MEDIUM);
    expect(within(row).getByText(/apply by 2026-08-01/)).toBeDefined();
    expect(within(row).getByText(/earliest realistic filing 2026-07-20/)).toBeDefined();
    expect(within(row).getByText(/deadline approaching/)).toBeDefined();
  });

  it("shows a gate carried by a route the row's own dates are not read off", async () => {
    const route = (ruleId: string, name: string, applyAfterDate: string | null) => ({
      ruleId,
      triggerResult: "true",
      disposition: "required",
      unknownFields: [],
      name,
      agency: "NYC",
      deadline: ruleId === "STREET-MEDIUM-001" ? { type: "before_issuance" } : null,
      deadlineDisplay: null,
      latestApplyDate: "2026-08-01",
      applyAfterDate,
      deadlineStatus: "on_track",
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
    });
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-01",
            applyAfterDate: null,
            deadlineStatus: "on_track",
            headlineMode: "applies_together",
            routes: [
              route("STREET-MEDIUM-001", "Street Activity Permit", null),
              route("NYPD-SOUND-001", "Sound device permit", "2026-07-20"),
            ],
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const row = rowFor(STREET_MEDIUM);
    expect(
      within(row).getByText(/earliest realistic filing for Sound device permit 2026-07-20/),
    ).toBeDefined();
    expect(within(row).queryByText(/earliest realistic filing 2026-07-20/)).toBeNull();
  });

  it("shows the binding route's gate when the row's dates come from a filing route", async () => {
    const route = (
      ruleId: string,
      name: string,
      applyAfterDate: string | null,
      latestApplyDate: string | null,
    ) => ({
      ruleId,
      triggerResult: "true",
      disposition: "required",
      unknownFields: [],
      name,
      agency: "NYC",
      deadline: ruleId === "STREET-MEDIUM-001" ? { type: "before_issuance" } : null,
      deadlineDisplay: null,
      latestApplyDate,
      applyAfterDate,
      deadlineStatus: latestApplyDate === null ? "not_applicable" : "on_track",
      feeDisplay: null,
      portalName: null,
      portalUrl: null,
      portalInstructions: null,
    });
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-01",
            applyAfterDate: null,
            deadlineStatus: "on_track",
            headlineMode: "applies_together",
            routes: [
              route("STREET-MEDIUM-001", "Street Activity Permit", "2026-07-20", null),
              route("NYPD-SOUND-001", "Sound device permit", null, "2026-08-01"),
            ],
            filingRouteRuleId: "NYPD-SOUND-001",
          }),
        ],
      }),
    });
    await renderView();

    const row = rowFor(STREET_MEDIUM);
    expect(
      within(row).getByText(/earliest realistic filing for Street Activity Permit 2026-07-20/),
    ).toBeDefined();
  });

  it("renders the deadline prose a rule publishes", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(PARKS_TUA)] }),
    });
    await renderView();

    expect(
      within(rowFor(PARKS_TUA)).getByText("submit vendor info at least two weeks prior"),
    ).toBeDefined();
  });

  it("renders the published deadline type for a rule that states nothing else", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(INSURANCE)] }),
    });
    await renderView();

    expect(within(rowFor(INSURANCE)).getByText("before issuance")).toBeDefined();
  });

  it("keeps every published qualification on an unresolved deadline", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(SOUND_DEPENDENCY, {
            verificationStatus: "RESEARCH_REQUIRED",
            deadlineStatus: "not_calculable",
            timelineUnresolvedReason: "the processing time is not published",
            deadlineUnknownFields: ["structure_types"],
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedRowFor(SOUND_DEPENDENCY);
    expect(within(row).getByText("the processing time is not published")).toBeDefined();
    expect(within(row).getByText("depends on: structure types")).toBeDefined();
    expect(within(row).getByText(noteTextOf(SOUND_DEPENDENCY) as string)).toBeDefined();
    expect(within(row).getByRole("note").textContent).toContain("agency");
  });

  it.each([CONFIRM_WITH_AGENCY, `14–60 days depending on level; ${CONFIRM_WITH_AGENCY}`])(
    "renders one confirmation when the deadline displays %s",
    async (deadlineDisplay) => {
      stubApi({
        [GET_CHECKLIST]: checklistOf({
          created: true,
          items: [
            trackedItem(SOUND_DEPENDENCY, {
              verificationStatus: "RESEARCH_REQUIRED",
              deadline: { type: "research_required", display: null, qualification: null },
              deadlineDisplay,
              deadlineStatus: "not_calculable",
            }),
          ],
        }),
      });
      await renderView();

      const row = rowFor(SOUND_DEPENDENCY);
      expect(row.textContent?.split(CONFIRM_WITH_AGENCY)).toHaveLength(2);
      expect(within(row).getByText("RESEARCH REQUIRED")).toBeDefined();
    },
  );

  it.each(["Published output note", "Published verification qualification"])(
    "keeps one confirmation visible before and after expanding a %s",
    async (publishedProse) => {
      const note = `${publishedProse}: ${CONFIRM_WITH_AGENCY}`;
      stubApi({
        [GET_CHECKLIST]: checklistOf({
          created: true,
          items: [
            trackedItem(SOUND_DEPENDENCY, {
              verificationStatus: "RESEARCH_REQUIRED",
              publishedNotes: [note],
            }),
          ],
        }),
      });
      await renderView();

      const row = rowFor(SOUND_DEPENDENCY);
      expect(within(row).getByRole("note").textContent).toBe(CONFIRM_WITH_AGENCY);
      expect(within(row).queryByText(note)).toBeNull();
      expect(row.textContent?.split(CONFIRM_WITH_AGENCY)).toHaveLength(2);

      await userEvent.click(within(row).getByRole("button", { name: /^Details for/ }));

      expect(within(row).queryByRole("note")).toBeNull();
      expect(within(row).getByText(note)).toBeDefined();
      expect(row.textContent?.split(CONFIRM_WITH_AGENCY)).toHaveLength(2);
      expect(within(row).getByText("RESEARCH REQUIRED")).toBeDefined();
    },
  );

  it("renders a portal with no published URL as text rather than a dead link", async () => {
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(SOUND)] }) });
    await renderView();

    const row = await expandedRowFor(SOUND);
    const portalName = portalNameOf(SOUND) as string;
    expect(portalUrlOf(SOUND)).toBeNull();
    expect(within(row).queryByRole("link", { name: portalName })).toBeNull();
    expect(
      within(row).getByText((_content, element) => {
        return (
          element?.tagName === "P" &&
          (element.textContent ?? "").startsWith(`apply at ${portalName}`)
        );
      }),
    ).toBeDefined();
  });

  it("renders distinct Scenario C Parks and precinct portals on one checklist (F-204 AC 5)", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem("PARKS-EVENT-001"), trackedItem(SOUND)],
      }),
    });
    await renderView();

    const parks = await expandedRowFor("PARKS-EVENT-001");
    expect(
      within(parks)
        .getByRole("link", { name: portalNameOf("PARKS-EVENT-001") as string })
        .getAttribute("href"),
    ).toBe(portalUrlOf("PARKS-EVENT-001"));

    const sound = await expandedRowFor(SOUND);
    expect(within(sound).queryByRole("link", { name: portalNameOf(SOUND) as string })).toBeNull();
    expect(
      within(sound).getByText((_content, element) => {
        return (
          element?.tagName === "P" &&
          (element.textContent ?? "").startsWith("apply at Local NYPD precinct")
        );
      }),
    ).toBeDefined();
  });

  it("labels each citation URL when a rule publishes more than one", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
    });
    await renderView();

    expect(screen.getByRole("link", { name: "source 1" })).toBeDefined();
    expect(screen.getByRole("link", { name: "source 2" })).toBeDefined();
  });
});

describe("F-206 AC 2 · every row shows its verification status", () => {
  it("badges a tracked row and a read-only context row alike", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM)],
        contextItems: [planContext(NOISE_ADVISORY)],
      }),
    });
    await renderView();

    expect(within(rowFor(STREET_MEDIUM)).getByTestId("verification-status").textContent).toBe(
      "SOURCE CONFIRMED",
    );
    expect(within(rowFor(NOISE_ADVISORY)).getByTestId("verification-status").textContent).toBe(
      "SOURCE CONFIRMED",
    );
  });

  it("renders both readings of an official conflict with every source it rests on", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(PARKS_TUA)] }),
    });
    await renderView();

    const row = await expandedRowFor(PARKS_TUA);
    expect(within(row).getByTestId("verification-status").textContent).toBe("OFFICIAL CONFLICT");
    expect(within(row).getByText(noteTextOf(PARKS_TUA) as string)).toBeDefined();
    expect(within(row).getAllByRole("link", { name: /^source \d$/ })).toHaveLength(4);
  });

  it("says the combination is not covered on a coverage gap carrying no citation", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        contextItems: [planContext(ALCOHOL_ADVISORY)],
      }),
    });
    await renderView();

    const row = rowFor(ALCOHOL_ADVISORY);
    expect(within(row).getByTestId("verification-status").textContent).toBe("COVERAGE GAP");
    expect(within(row).getByText(NOT_COVERED_BY_RULESET)).toBeDefined();
    expect(within(row).queryByRole("link")).toBeNull();
  });
});

describe("F-206 AC 5 · the stored verification date, and only when it was stored", () => {
  it("renders the date the plan item carries", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { lastVerifiedDate: "2026-07-01" })],
        contextItems: [planContext(NOISE_ADVISORY, { lastVerifiedDate: "2026-06-15" })],
      }),
    });
    await renderView();

    expect(within(rowFor(STREET_MEDIUM)).getByText("last verified 2026-07-01")).toBeDefined();
    expect(within(rowFor(NOISE_ADVISORY)).getByText("last verified 2026-06-15")).toBeDefined();
  });

  it("renders no date at all when the item stored none", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        snapshotDate: "2026-07-26",
        items: [trackedItem(STREET_MEDIUM, { lastVerifiedDate: null })],
      }),
    });
    await renderView();

    const row = rowFor(STREET_MEDIUM);
    expect(within(row).queryByText(/last verified/)).toBeNull();
    expect(within(row).queryByText(/2026-07-26/)).toBeNull();
  });
});

describe("AC 6 · a regenerated plan is reviewed, never silently applied", () => {
  it("flags the change, strikes the dropped row through and keeps everything on it", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: true,
        statusRollup: rollupOf({ not_started: 1 }),
        items: [
          trackedItem(STREET_LARGE, {
            struckThrough: true,
            status: "submitted",
            notes: "filed on the 3rd",
            documents: [{ id: "doc-1", filename: "receipt.pdf" }],
          }),
          trackedItem(STREET_MEDIUM),
        ],
      }),
    });
    await renderView();

    expect(screen.getByRole("alert").textContent).toContain("The plan has changed; review items.");

    const dropped = rowFor(STREET_LARGE);
    expect(dropped.className).toContain("check-item--dropped");
    expect(within(dropped).getByRole("note").textContent).toContain("earlier task has ended");
    expect(badgeOf(dropped)).toBe("submitted");
    expect((within(dropped).getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "filed on the 3rd",
    );
    expect(within(dropped).getByText("receipt.pdf")).toBeDefined();
  });

  it("reviews against the current plan through the same idempotent conversion call", async () => {
    let current = checklistBody({
      created: true,
      planChanged: true,
      items: [trackedItem(STREET_LARGE, { struckThrough: true })],
    });
    const calls = stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [POST_CHECKLIST]: () => {
        current = checklistBody({
          created: true,
          planChanged: false,
          items: [trackedItem(STREET_LARGE, { struckThrough: true }), trackedItem(SOUND)],
        });
        return jsonResponse(201, current);
      },
    });
    await renderView();

    await userEvent.click(
      screen.getByRole("button", { name: "Review items against the current plan" }),
    );

    expect(await screen.findByRole("heading", { name: nameOf(SOUND) })).toBeDefined();
    expect(rowFor(STREET_LARGE).className).toContain("check-item--dropped");
    expect(screen.queryByText(/The plan has changed/)).toBeNull();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("does not install the conversion's own response over a newer item update", async () => {
    const calls = stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: true,
        statusRollup: rollupOf({ submitted: 1 }),
        items: [trackedItem(STREET_MEDIUM, { status: "submitted" })],
      }),
      [POST_CHECKLIST]: () =>
        jsonResponse(
          201,
          checklistBody({
            created: true,
            statusRollup: rollupOf({ not_started: 1 }),
            items: [trackedItem(STREET_MEDIUM, { status: "not_started" })],
          }),
        ),
    });
    await renderView();

    await userEvent.click(
      screen.getByRole("button", { name: "Review items against the current plan" }),
    );

    await waitFor(() => expect(badgeOf(rowFor(STREET_MEDIUM))).toBe("submitted"));
    expect(document.querySelector(".checklist__rollup")?.textContent).toBe("1 submitted");
    expect(checklistReads(calls)).toHaveLength(2);
  });

  it("reports a conversion that landed while the re-read did not", async () => {
    let reloads = 0;
    stubApi({
      [GET_CHECKLIST]: () => {
        reloads += 1;
        return reloads === 1
          ? jsonResponse(
              200,
              checklistBody({
                created: true,
                planChanged: true,
                items: [trackedItem(STREET_MEDIUM)],
              }),
            )
          : jsonResponse(500, {});
      },
      [POST_CHECKLIST]: () =>
        jsonResponse(201, checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] })),
    });
    await renderView();

    await userEvent.click(
      screen.getByRole("button", { name: "Review items against the current plan" }),
    );

    expect(
      await screen.findByText(
        "The change was saved, but the checklist could not be reloaded: The checklist could not be loaded (HTTP 500).",
      ),
    ).toBeDefined();
  });

  it("does not offer a review when the plan it would review against is stale", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: true,
        planStale: true,
        items: [trackedItem(STREET_MEDIUM)],
      }),
    });
    await renderView();

    expect(screen.queryByRole("button", { name: /Review items/ })).toBeNull();
  });
});

describe("F-203 · the alert contact stays correctable after the checklist exists", () => {
  it("still offers the contact fields and a save on a current checklist", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: false,
        items: [trackedItem()],
        alertContacts: { email: "typo@example.test", phone: null },
      }),
    });

    await renderView();

    expect(screen.getByLabelText<HTMLInputElement>("Email for deadline reminders").value).toBe(
      "typo@example.test",
    );
    expect(screen.getByRole("button", { name: "Save contact details" })).toBeDefined();
  });

  it("sends the corrected address with the plan the page is showing", async () => {
    let current = checklistBody({
      created: true,
      planChanged: false,
      alertContacts: { email: "typo@example.test", phone: null },
    });
    stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [POST_CHECKLIST]: () => {
        current = checklistBody({
          created: true,
          planChanged: false,
          alertContacts: { email: "organizer@example.test", phone: null },
        });
        return jsonResponse(200, current);
      },
    });
    await renderView();

    const email = screen.getByLabelText("Email for deadline reminders");
    await userEvent.clear(email);
    await userEvent.type(email, "organizer@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Save contact details" }));

    await waitFor(() => {
      expect(
        (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.some(
          ([, init]) =>
            init?.method === "POST" &&
            String(init.body).includes('"contactEmail":"organizer@example.test"'),
        ),
      ).toBe(true);
    });
  });

  it("shows a delivery failure that only happened after the page was rendered", async () => {
    let failures: unknown[] = [];
    const body = () =>
      checklistBody({
        created: true,
        planChanged: false,
        alertContacts: { email: "typo@example.test", phone: null },
        failedAlertDeliveries: failures,
      });
    stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, body()),
      [POST_CHECKLIST]: () => jsonResponse(200, body()),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderView();

      await userEvent.click(screen.getByRole("button", { name: "Save contact details" }));
      await waitFor(() => expect(screen.queryByText(/not been confirmed as delivered/)).toBeNull());

      failures = [{ channel: "email", failedCount: 1, heldForReview: false }];
      await vi.advanceTimersByTimeAsync(61_000);

      await waitFor(() =>
        expect(screen.getByText(/not been confirmed as delivered/).textContent).toContain(
          "1 email alert for this event has not been confirmed as delivered.",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not keep re-reading when there is no contact for an alert to go to", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: false,
        alertContacts: { email: null, phone: null },
      }),
      [POST_CHECKLIST]: checklistOf({
        created: true,
        planChanged: false,
        alertContacts: { email: null, phone: null },
      }),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderView();
      await userEvent.click(screen.getByRole("button", { name: "Save contact details" }));
      await waitFor(() =>
        expect(
          (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.some(
            ([, init]) => init?.method === "POST",
          ),
        ).toBe(true),
      );
      const before = (global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

      await vi.advanceTimersByTimeAsync(130_000);

      expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
        before,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not promise email reminders to a contact that has no email", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: false,
        alertContacts: { email: null, phone: "+15550000000" },
      }),
    });

    await renderView();

    expect(screen.queryByText(/addressed to your email/)).toBeNull();
    const lede = screen.getByText(/no deadline reminders will be delivered/);
    expect(lede.textContent).toContain(
      "Text messages are not being sent yet, and no email address is set, so no deadline " +
        "reminders will be delivered. Add an email address to receive them.",
    );
    expect(lede.textContent).toContain("stored for when text sending is switched on");
    expect((screen.getByLabelText("Mobile number (optional)") as HTMLInputElement).value).toBe(
      "+15550000000",
    );
  });

  it("says where reminders are addressed without promising they arrive", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: false,
        alertContacts: { email: "organizer@example.test", phone: null },
      }),
    });

    await renderView();

    expect(screen.getByText(/addressed to your email/).textContent).toContain(
      "Text messages are not being sent yet, so deadline reminders are addressed to your email",
    );
    expect(screen.queryByText(/reminders go to your email/)).toBeNull();
    expect(screen.queryByText(/no deadline reminders will be delivered/)).toBeNull();
  });

  it("hides the contact controls while the plan is stale, because the api would refuse them", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, planChanged: false, planStale: true }),
    });

    await renderView();

    expect(screen.queryByLabelText("Email for deadline reminders")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save contact details" })).toBeNull();
  });
});

describe("F-203 · a channel that failed to deliver is reported to the organizer", () => {
  it("says how many failed, on which channel, and what the organizer can do", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        failedAlertDeliveries: [{ channel: "email", failedCount: 2, heldForReview: false }],
        alertContacts: { email: "typo@example.test", phone: null },
      }),
    });

    await renderView();

    const notice = screen.getByText(/not been confirmed as delivered/);
    expect(notice.textContent).toBe(
      "2 email alerts for this event have not been confirmed as delivered. PopEngine keeps " +
        "retrying them. If the email address below is wrong, correcting it will redirect the " +
        "alerts that have not gone out.",
    );
    expect(notice.getAttribute("role")).toBe("alert");
    expect(screen.getByLabelText("Email for deadline reminders")).toBeDefined();
  });

  it("does not claim retries are running while the plan is stale", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        failedAlertDeliveries: [{ channel: "email", failedCount: 2, heldForReview: true }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/not been confirmed as delivered/);
    expect(notice.textContent).toContain(
      "2 email alerts for this event have not been confirmed as delivered.",
    );
    expect(notice.textContent).toContain(
      "Retrying is paused because this event changed after their plan was made: regenerate the " +
        "plan and review the checklist to start it again.",
    );
    expect(notice.textContent).not.toContain("PopEngine keeps retrying them");
  });

  it("does not promise the review restarts an alert whose outcome was never observed", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        failedAlertDeliveries: [
          { channel: "email", failedCount: 2, heldForReview: true, attemptedWithoutOutcome: true },
        ],
      }),
    });

    await renderView();

    const notice = screen.getByText(/not been confirmed as delivered/);
    expect(notice.textContent).toContain("Retrying is paused because this event changed");
    expect(notice.textContent).toContain(
      "will not restart any that were already attempted with no outcome recorded",
    );
    expect(notice.textContent).toContain("checks with the sending service");
  });

  it("does not turn an unknown delivery outcome into a definite non-delivery", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        failedAlertDeliveries: [{ channel: "email", failedCount: 2, heldForReview: false }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/not been confirmed as delivered/);
    expect(notice.textContent).not.toContain("failed to send");
    expect(notice.textContent).toContain(
      "2 email alerts for this event have not been confirmed as delivered.",
    );
  });

  it("reads the paused state from the failed rows rather than the latest plan", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planStale: false,
        planChanged: false,
        failedAlertDeliveries: [{ channel: "email", failedCount: 1, heldForReview: true }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/not been confirmed as delivered/);
    expect(notice.textContent).toContain("Retrying is paused because this event changed");
    expect(notice.textContent).not.toContain("PopEngine keeps retrying them");
  });

  it("agrees with itself on one failure", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        failedAlertDeliveries: [{ channel: "email", failedCount: 1, heldForReview: false }],
      }),
    });

    await renderView();

    expect(screen.getByText(/not been confirmed as delivered/).textContent).toContain(
      "1 email alert for this event has not been confirmed as delivered.",
    );
  });

  it("says nothing at all when no failure was observed", async () => {
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: true, failedAlertDeliveries: [] }) });

    await renderView();

    expect(screen.queryByText(/not been confirmed as delivered/)).toBeNull();
    expect(screen.queryByText(/working|delivering|sent normally/)).toBeNull();
  });

  it("tells the organizer when delivery has stopped rather than paused or continued", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        alertsHeldForReconciliation: [{ channel: "email", heldCount: 2 }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/no outcome ever came back/);
    expect(notice.textContent).toBe(
      "2 email alerts for this event were recorded as attempted sends, and no outcome ever came " +
        "back: PopEngine cannot tell whether they reached the sending service at all. Too much " +
        "time has passed to try them again straight away without risking a second copy, so " +
        "PopEngine has paused them: nothing on their current schedule sends them again for now. " +
        "Someone can check with the sending service whether they went out, and what that check " +
        "records decides whether this schedule sends them sooner; if nobody does, PopEngine " +
        "tries once more when the pause ends, and that may arrive as a second copy. Until then, " +
        "do not count on them to remind you of the filing dates they cover.",
    );
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).not.toContain("keeps retrying");
  });

  it("does not promise a held alert can never be sent again", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        alertsHeldForReconciliation: [{ channel: "email", heldCount: 1 }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/no outcome ever came back/);
    expect(notice.textContent).not.toMatch(/will not be sent again on (its|their) own/);
    expect(notice.textContent).toContain("current schedule");
  });

  it("does not rule out a send that reconciliation can release", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        alertsHeldForReconciliation: [{ channel: "email", heldCount: 2 }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/no outcome ever came back/);
    expect(notice.textContent).toContain(
      "nothing on their current schedule sends them again for now",
    );
    expect(notice.textContent).toMatch(/what that check records decides whether/);
    expect(notice.textContent).not.toMatch(/will send them again\./);
    expect(notice.textContent).toMatch(/tries once more when the pause ends/);
  });

  it("does not assert a handoff it cannot prove happened", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        alertsHeldForReconciliation: [{ channel: "email", heldCount: 1 }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/no outcome ever came back/);
    expect(notice.textContent).not.toMatch(/(was|were) handed to the sending service/);
    expect(notice.textContent).toMatch(/attempted send/);
    expect(notice.textContent).not.toMatch(/whether (it|they) arrived/);
  });

  it("agrees with itself on one stopped alert", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        alertsHeldForReconciliation: [{ channel: "email", heldCount: 1 }],
      }),
    });

    await renderView();

    expect(screen.getByText(/no outcome ever came back/).textContent).toBe(
      "1 email alert for this event was recorded as an attempted send, and no outcome ever came " +
        "back: PopEngine cannot tell whether it reached the sending service at all. Too much " +
        "time has passed to try it again straight away without risking a second copy, so " +
        "PopEngine has paused it: nothing on its current schedule sends it again for now. " +
        "Someone can check with the sending service whether it went out, and what that check " +
        "records decides whether this schedule sends it sooner; if nobody does, PopEngine tries " +
        "once more when the pause ends, and that may arrive as a second copy. Until then, do not " +
        "count on it to remind you of the filing date it covers.",
    );
  });

  it("says nothing when no alert is stopped", async () => {
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: true, alertsHeldForReconciliation: [] }) });

    await renderView();

    expect(screen.queryByText(/no outcome ever came back/)).toBeNull();
  });

  it("keeps a stopped alert and a retrying failure as separate statements", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        failedAlertDeliveries: [{ channel: "email", failedCount: 1, heldForReview: false }],
        alertsHeldForReconciliation: [{ channel: "email", heldCount: 1 }],
      }),
    });

    await renderView();

    const retrying = screen.getByText(/not been confirmed as delivered/);
    const stopped = screen.getByText(/no outcome ever came back/);
    expect(retrying).not.toBe(stopped);
    expect(retrying.textContent).toContain("PopEngine keeps retrying them");
    expect(stopped.textContent).not.toContain("keeps retrying");
  });

  it("keeps a switched-off channel and a failing channel as separate statements", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        simulatedAlertDeliveries: [{ channel: "sms", sentCount: 1 }],
        failedAlertDeliveries: [{ channel: "email", failedCount: 3, heldForReview: false }],
      }),
    });

    await renderView();

    const simulated = screen.getByText(/No text messages have been sent\./);
    const failed = screen.getByText(/not been confirmed as delivered/);
    expect(simulated).not.toBe(failed);
    expect(simulated.textContent).not.toContain("not been confirmed as delivered");
    expect(failed.textContent).not.toContain("not switched on yet");
  });
});

describe("F-203 AC 5 · a simulated alert is labelled where the organizer reads it", () => {
  it("says no text messages were sent and how many did not arrive", async () => {
    stubApi({
      [GET_CHECKLIST]: () =>
        jsonResponse(
          200,
          checklistBody({
            created: true,
            simulatedAlertDeliveries: [{ channel: "sms", sentCount: 2 }],
          }),
        ),
    });

    await renderView();

    const notice = screen.getByText(/No text messages have been sent\./);
    expect(notice.textContent).toBe(
      "No text messages have been sent. PopEngine recorded 2 text message alerts for this event, " +
        "but text message sending is not switched on yet, so nothing was delivered.",
    );
    expect(notice.textContent).not.toContain("Email alerts are sent normally");
    expect(notice.getAttribute("role")).toBe("alert");
  });

  it("says nothing at all when every alert that reported sent was really sent", async () => {
    stubApi({
      [GET_CHECKLIST]: () =>
        jsonResponse(200, checklistBody({ created: true, simulatedAlertDeliveries: [] })),
    });

    await renderView();

    expect(screen.queryByText(/have been sent\./)).toBeNull();
    expect(screen.queryByText(/not switched on yet/)).toBeNull();
    expect(screen.queryByText(/nothing was delivered/)).toBeNull();
  });

  it("counts one alert as one, and names a channel it has no word for rather than dropping it", async () => {
    stubApi({
      [GET_CHECKLIST]: () =>
        jsonResponse(
          200,
          checklistBody({
            created: true,
            simulatedAlertDeliveries: [
              { channel: "sms", sentCount: 1 },
              { channel: "carrier_pigeon", sentCount: 3 },
            ],
          }),
        ),
    });

    await renderView();

    expect(screen.getByText(/1 text message alert for this event/)).toBeDefined();
    expect(screen.getByText(/3 carrier_pigeon alerts for this event/)).toBeDefined();
  });
});

describe("AC 7 · the demo path", () => {
  it("converts the rescoped plan, flips one status and uploads one document", async () => {
    let current = checklistBody({ created: false });
    stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [POST_CHECKLIST]: () => {
        current = checklistBody({
          created: true,
          statusRollup: rollupOf({ not_started: 1 }),
          items: [trackedItem(STREET_MEDIUM)],
        });
        return jsonResponse(201, current);
      },
      [itemRoute("PATCH", STREET_MEDIUM)]: () => {
        current = checklistBody({
          created: true,
          statusRollup: rollupOf({ submitted: 1 }),
          items: [trackedItem(STREET_MEDIUM, { status: "submitted" })],
        });
        return jsonResponse(200, {
          id: `item-${STREET_MEDIUM}`,
          status: "submitted",
          notes: null,
        });
      },
      [itemRoute("POST", STREET_MEDIUM, "/documents")]: () => {
        current = checklistBody({
          created: true,
          statusRollup: rollupOf({ submitted: 1 }),
          items: [
            trackedItem(STREET_MEDIUM, {
              status: "submitted",
              documents: [{ id: "doc-1", filename: "application.pdf" }],
            }),
          ],
        });
        return jsonResponse(201, { id: "doc-1", filename: "application.pdf" });
      },
    });
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: /Create the checklist/ }));
    await screen.findByRole("heading", { name: nameOf(STREET_MEDIUM) });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: `Status for ${nameOf(STREET_MEDIUM)}` }),
      "submitted",
    );
    await waitFor(() => expect(badgeOf(rowFor(STREET_MEDIUM))).toBe("submitted"));

    await userEvent.upload(
      screen.getByLabelText(`Add a document to ${nameOf(STREET_MEDIUM)}`),
      new File([new Uint8Array(8)], "application.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("application.pdf")).toBeDefined();
    expect(document.querySelector(".checklist__rollup")?.textContent).toBe("1 submitted");
  });
});

describe("AC 8 · each row is attributed to the plan its values came from", () => {
  it("does not repeat the banner's snapshot on a row that came from it", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
    });
    await renderView();

    expect(screen.getByLabelText("Rules snapshot").textContent).toContain(
      `Rules snapshot ${PUBLISHED_SNAPSHOT.rulesetVersion}`,
    );
    expect(document.querySelector(".check-item__provenance")).toBeNull();
  });

  it("states a dropped row's own version and date, both from the plan that last raised it", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_LARGE, {
            struckThrough: true,
            sourcePlan: { rulesetVersion: "nyc.v2.5", snapshotDate: "2026-06-01" },
          }),
        ],
      }),
    });
    await renderView();

    expect(
      within(rowFor(STREET_LARGE)).getByText(
        "Dates from rules snapshot nyc.v2.5 · published June 1, 2026",
      ),
    ).toBeDefined();
  });

  it("says a version's publication date was never recorded rather than borrowing one", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_LARGE, {
            struckThrough: true,
            sourcePlan: { rulesetVersion: "nyc.v2.3", snapshotDate: null },
          }),
        ],
      }),
    });
    await renderView();

    expect(
      screen.getByText(
        "Dates from rules snapshot nyc.v2.3 · publication date not recorded for that plan",
      ),
    ).toBeDefined();
  });

  it("never lets the live rules file supply a displayed version or date", async () => {
    const calls = stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        rulesetVersion: "nyc.v2.5",
        snapshotDate: "2026-06-01",
        items: [
          trackedItem(STREET_MEDIUM, {
            struckThrough: true,
            sourcePlan: { rulesetVersion: "nyc.v2.1", snapshotDate: "2026-01-01" },
          }),
        ],
      }),
      [GET_META]: () =>
        jsonResponse(200, { ruleset_version: "nyc.v9.9", snapshot_date: "2026-12-31" }),
    });
    await renderView();

    const banner = await screen.findByLabelText("Rules snapshot");
    expect(banner.textContent).toContain("Rules snapshot nyc.v2.5");
    expect(banner.textContent).toContain("published June 1, 2026");
    expect(banner.textContent).not.toContain("December 31, 2026");
    expect(screen.getByText(/Dates from rules snapshot nyc\.v2\.1/)).toBeDefined();
    await waitFor(() => expect(banner.textContent).toContain("a newer ruleset (nyc.v9.9) exists"));
    expect(calls.some((call) => call.url.includes("/api/rules/meta"))).toBe(true);
  });

  it("points at the plan view for the regeneration its banner names", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, rulesetVersion: "nyc.v2.5" }),
      [GET_META]: () =>
        jsonResponse(200, { ruleset_version: "nyc.v9.9", snapshot_date: "2026-12-31" }),
    });
    await renderView();

    expect(
      (await screen.findByRole("link", { name: "Regenerate the plan" })).getAttribute("href"),
    ).toBe(`/events/${EVENT}/plan`);
  });

  it("says nothing about regenerating when the service is on the plan's own ruleset", async () => {
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: true }) });
    await renderView();

    expect(screen.queryByRole("link", { name: "Regenerate the plan" })).toBeNull();
  });
});

describe("edge cases", () => {
  it("offers creation for a plan with nothing trackable, and produces a read-only empty state", async () => {
    const empty = { created: true, items: [], contextItems: [planContext(ALCOHOL_ADVISORY)] };
    let current = checklistBody({ ...empty, created: false });
    stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [POST_CHECKLIST]: () => {
        current = checklistBody(empty);
        return jsonResponse(201, current);
      },
    });
    await renderView();

    await userEvent.click(screen.getByRole("button", { name: /Create the checklist/ }));

    expect(
      await screen.findByText("Nothing to track; keep confirmation notes here if you like."),
    ).toBeDefined();
    const context = rowFor(ALCOHOL_ADVISORY);
    expect(within(context).queryByRole("combobox")).toBeNull();
    expect(within(context).queryByRole("textbox")).toBeNull();
    expect(within(context).queryByRole("button")).toBeNull();
  });

  it("groups blockers, tasks, and context in that order without turning read-only rows into tasks", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(PARKS_TUA),
          trackedItem(STREET_MEDIUM, { disposition: "prohibited_or_ineligible" }),
        ],
        contextItems: [planContext(NOISE_ADVISORY)],
      }),
    });
    await renderView();

    const regions = screen.getAllByRole("region");
    expect(regions.map((region) => region.getAttribute("aria-labelledby"))).toEqual([
      "checklist-blockers-heading",
      "checklist-tasks-heading",
      "checklist-context-heading",
    ]);
    expect(screen.getByRole("heading", { name: "Blockers" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Permit and insurance tasks" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Advisories and notifications" })).toBeDefined();

    const blocker = rowFor(STREET_MEDIUM);
    expect(within(blocker).getByText("blocker")).toBeDefined();
    expect(within(blocker).getByText("prohibited or ineligible")).toBeDefined();
    expect(within(blocker).queryByRole("combobox")).toBeNull();
    expect(within(blocker).queryByRole("textbox")).toBeNull();
    expect(within(blocker).queryByRole("button", { name: /save notes|upload/i })).toBeNull();

    const task = rowFor(PARKS_TUA);
    expect(within(task).getByText("may be required")).toBeDefined();
    expect(within(task).getByRole("combobox")).toBeDefined();
    expect(within(task).getByRole("textbox")).toBeDefined();

    const context = rowFor(NOISE_ADVISORY);
    expect(within(context).getAllByText("advisory")).toHaveLength(2);
    expect(within(context).queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/no blockers/i)).toBeNull();
  });

  it("omits empty checklist groups without claiming there are no blockers", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
    });
    await renderView();

    expect(screen.queryByRole("heading", { name: "Blockers" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Permit and insurance tasks" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Advisories and notifications" })).toBeNull();
    expect(screen.queryByText(/no blockers/i)).toBeNull();
  });

  it("converting a second time returns the existing checklist without duplicating a row", async () => {
    const existing = checklistBody({
      created: true,
      planChanged: true,
      items: [trackedItem(STREET_MEDIUM)],
    });
    const calls = stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, existing),
      [POST_CHECKLIST]: () => jsonResponse(200, existing),
    });
    await renderView();

    await userEvent.click(
      screen.getByRole("button", { name: "Review items against the current plan" }),
    );

    await waitFor(() =>
      expect(screen.getAllByRole("heading", { name: nameOf(STREET_MEDIUM) })).toHaveLength(1),
    );
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("re-presents the newer plan when the one on screen was superseded, and says nothing was recorded", async () => {
    const shown = checklistBody({
      created: true,
      planChanged: true,
      items: [trackedItem(STREET_MEDIUM)],
    });
    const newer = checklistBody({
      planId: "plan-3",
      created: true,
      planChanged: true,
      items: [trackedItem(STREET_LARGE)],
    });
    let current = shown;
    stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [POST_CHECKLIST]: () => {
        current = newer;
        return jsonResponse(409, {
          error: "plan plan-2 is no longer the latest plan for event event-1",
          supersededPlanId: "plan-2",
          checklist: newer,
        });
      },
    });
    await renderView();

    await userEvent.click(
      screen.getByRole("button", { name: "Review items against the current plan" }),
    );

    await waitFor(() => expect(screen.getByText(/nothing was recorded/i)).toBeTruthy());
    expect(screen.getAllByRole("heading", { name: nameOf(STREET_LARGE) })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: nameOf(STREET_MEDIUM) })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review items against the current plan" }),
    ).toBeTruthy();
  });

  it("cannot send a second conversion while the first is still in flight", async () => {
    let release: ((response: Response) => void) | undefined;
    let current = checklistBody({ created: false });
    const calls = stubApi({
      [GET_CHECKLIST]: () => jsonResponse(200, current),
      [POST_CHECKLIST]: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }) as unknown as Response,
    });
    await renderView();

    const create = screen.getByRole("button", { name: /Create the checklist/ });
    await userEvent.click(create);
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(true));
    await userEvent.click(create);

    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    current = checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] });
    release?.(jsonResponse(201, current));
    expect(await screen.findByRole("heading", { name: nameOf(STREET_MEDIUM) })).toBeDefined();
  });

  it("uses the organizer summary when a requirement publishes no permit name", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            permitName: null,
            portalName: null,
            portalUrl: null,
          }),
          trackedItem(SOUND, { portalName: null }),
        ],
      }),
    });
    await renderView();

    expect(
      within(rowFor(SOUND)).queryByRole("link", { name: portalUrlOf(SOUND) ?? "" }),
    ).toBeNull();

    const row = screen.getByRole("article", { name: nameOf(STREET_MEDIUM) });
    expect(
      within(row).getByRole("combobox", { name: `Status for ${nameOf(STREET_MEDIUM)}` }),
    ).toBeDefined();
  });

  it("does not apply a late reload to a page that has moved to another event", async () => {
    let release: ((response: Response) => void) | undefined;
    let reloads = 0;
    stubApi({
      [GET_CHECKLIST]: () => {
        reloads += 1;
        if (reloads === 1) {
          return jsonResponse(
            200,
            checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
          );
        }
        return new Promise<Response>((resolve) => {
          release = resolve;
        }) as unknown as Response;
      },
      "GET /api/events/event-2/checklist": checklistOf({ created: true, items: [] }),
      [itemRoute("PATCH", STREET_MEDIUM)]: () =>
        jsonResponse(200, { id: `item-${STREET_MEDIUM}`, status: "approved", notes: null }),
    });

    const view = render(<ChecklistView apiBaseUrl={API} eventId={EVENT} />);
    await screen.findByRole("heading", { name: nameOf(STREET_MEDIUM) });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: `Status for ${nameOf(STREET_MEDIUM)}` }),
      "approved",
    );

    view.rerender(<ChecklistView apiBaseUrl={API} eventId="event-2" />);
    release?.(
      jsonResponse(200, checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] })),
    );

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("heading", { name: nameOf(STREET_MEDIUM) })).toBeNull();
  });

  it("drops a checklist that arrives after the page has moved to another event", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/rules/meta")) {
          return jsonResponse(200, {
            ruleset_version: PUBLISHED_SNAPSHOT.rulesetVersion,
            snapshot_date: PUBLISHED_SNAPSHOT.snapshotDate,
          });
        }
        if (String(input).includes("event-1")) {
          await pending;
          return jsonResponse(
            200,
            checklistBody({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
          );
        }
        return jsonResponse(200, checklistBody({ created: true, items: [] }));
      }),
    );

    const view = render(<ChecklistView apiBaseUrl={API} eventId="event-1" />);
    view.rerender(<ChecklistView apiBaseUrl={API} eventId="event-2" />);
    release?.();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    expect(screen.queryByRole("heading", { name: nameOf(STREET_MEDIUM) })).toBeNull();
  });
});

describe("reaching the checklist at all", () => {
  it("links to the checklist from the plan route", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", API);
    vi.stubEnv("RULES_FILE", publishedRulesFileIn("rules"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Promise(() => {})),
    );

    render(await PlanPage({ params: Promise.resolve({ id: EVENT }) }));

    expect(
      screen
        .getByRole("link", { name: "Track this plan on your compliance checklist" })
        .getAttribute("href"),
    ).toBe(`/events/${EVENT}/checklist`);
    vi.unstubAllEnvs();
  });
});

describe("the checklist route", () => {
  it("hands the view the configured api and the event from the path", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", API);
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: false }) });

    render(await ChecklistPage({ params: Promise.resolve({ id: EVENT }) }));

    expect(
      await screen.findByRole("button", { name: "Create the checklist from this plan" }),
    ).toBeDefined();
    vi.unstubAllEnvs();
  });

  it("falls back to the local api in development", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/rules/meta")
        ? jsonResponse(200, {
            ruleset_version: PUBLISHED_SNAPSHOT.rulesetVersion,
            snapshot_date: PUBLISHED_SNAPSHOT.snapshotDate,
          })
        : jsonResponse(200, checklistBody({})),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(await ChecklistPage({ params: Promise.resolve({ id: EVENT }) }));

    await waitFor(() =>
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `http://localhost:3001/api/events/${EVENT}/checklist`,
      ),
    );
    vi.unstubAllEnvs();
  });
});

describe("a fee stated only where the ruleset states one", () => {
  it("renders no fee row when the row carries no amount, whatever the row is", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { feeDisplay: null })],
        contextItems: [planContext(NOISE_ADVISORY)],
      }),
    });
    await renderView();

    for (const ruleId of [STREET_MEDIUM, NOISE_ADVISORY]) {
      const row = await expandedRowFor(ruleId);
      expect(within(row).queryByText("fee not published")).toBeNull();
      expect(row.querySelector(".check-item__text:empty")).toBeNull();
    }
  });

  it("renders the published amount when the ruleset publishes one", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
    });
    await renderView();

    const fee = feeOf(STREET_MEDIUM);
    expect(fee).not.toBeNull();
    expect(within(await expandedRowFor(STREET_MEDIUM)).getByText(fee as string)).toBeDefined();
  });

  it("uses the published organizer heading without exposing internal rule codes", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { lastVerifiedDate: "2026-07-01" })],
        contextItems: [planContext(NOISE_ADVISORY)],
      }),
    });
    await renderView();

    const row = await expandedRowFor(STREET_MEDIUM);
    expect(within(row).getByRole("heading", { name: nameOf(STREET_MEDIUM) })).toBeDefined();
    expect(row.textContent).not.toContain(STREET_MEDIUM);
    expect(row.querySelectorAll(".check-item__verified-date")).toHaveLength(1);
    const context = rowFor(NOISE_ADVISORY);
    expect(within(context).getByRole("heading", { name: nameOf(NOISE_ADVISORY) })).toBeDefined();
    expect(context.textContent).not.toContain(NOISE_ADVISORY);
  });
});

describe("the checklist's expand control matches what is behind it", () => {
  it("offers no expand on a row whose only extra fact is stated in its summary", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        contextItems: [
          planContext(NOISE_ADVISORY, {
            lastVerifiedDate: "2026-06-15",
            noteText: null,
            conflictText: null,
            publishedNotes: [],
            portalName: null,
            portalUrl: null,
            portalInstructions: null,
            timelineUnresolvedReason: null,
            deadlineUnknownFields: [],
            sources: [],
          }),
        ],
      }),
    });
    await renderView();

    const row = rowFor(NOISE_ADVISORY);
    expect(within(row).queryByRole("button", { name: /^Details for/ })).toBeNull();

    expect(within(row).getByText("last verified 2026-06-15")).toBeDefined();
    expect(row.textContent).not.toContain(NOISE_ADVISORY);
  });
});

describe("F-202 AC 9 · moved-deadline notice", () => {
  it("renders previous and current dates with full previous provenance", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-30",
            deadlineNotice: {
              dateChange: {
                kind: "both",
                previous: "2026-07-12",
                current: "2026-08-30",
              },
              stateChange: null,
              previousProvenance: {
                verificationStatus: "SOURCE_CONFIRMED",
                lastVerifiedDate: "2026-07-01",
                sources: [
                  {
                    ruleId: STREET_MEDIUM,
                    citation: "CECM permit-deadlines page",
                    urls: ["https://example.gov/a", "https://example.gov/b"],
                  },
                ],
                sourceUrl: "https://example.gov/a",
                conflictText: null,
                rulesetVersion: "test.v1",
                snapshotDate: "2026-07-20",
              },
              rulesetVersionsDiffer: true,
              previousRulesetVersion: "test.v1",
              currentRulesetVersion: "test.v2",
            },
          }),
        ],
        statusRollup: { not_started: 1, in_progress: 0, submitted: 0, approved: 0, rejected: 0 },
      }),
    });
    await renderView();

    const notice = await screen.findByTestId("moved-deadline-notice");
    expect(notice.textContent).toContain("Previous: 2026-07-12");
    expect(notice.textContent).toContain("Current: 2026-08-30");
    expect(notice.textContent).toContain(
      "does not by itself establish anything about a filed application",
    );
    expect(notice.textContent?.toLowerCase()).not.toContain("amend");
    expect(screen.getByTestId("previous-verification-status").textContent).toContain(
      "SOURCE CONFIRMED",
    );
    expect(screen.getByTestId("previous-sources").textContent).toContain(
      "CECM permit-deadlines page",
    );
    expect(
      within(screen.getByTestId("previous-sources"))
        .getByRole("link", { name: "source 1" })
        .getAttribute("href"),
    ).toBe("https://example.gov/a");
    expect(notice.textContent).toContain("https://example.gov/a");
  });

  it("states an unresolved-deadline delta when the status remains not calculable", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            deadlineNotice: {
              dateChange: null,
              stateChange: {
                previous: {
                  deadlineStatus: "not_calculable",
                  deadline: {
                    type: "business_days_minimum",
                    businessDays: 10,
                    display: "published filing window",
                    boundary: "inclusive",
                    qualification: null,
                  },
                  deadlineDisplay: "published filing window",
                  timelineUnresolvedReason: "holiday calendar was unavailable",
                  deadlineUnknownFields: [],
                  gated: false,
                },
                current: {
                  deadlineStatus: "not_calculable",
                  deadline: {
                    type: "business_days_minimum",
                    businessDays: 10,
                    display: "published filing window",
                    boundary: "inclusive",
                    qualification: null,
                  },
                  deadlineDisplay: "published filing window",
                  timelineUnresolvedReason: "processing time is unavailable",
                  deadlineUnknownFields: [],
                  gated: false,
                },
              },
              previousProvenance: {
                verificationStatus: "SOURCE_CONFIRMED",
                lastVerifiedDate: null,
                sources: [],
                sourceUrl: null,
                conflictText: null,
                rulesetVersion: "test.v1",
                snapshotDate: "2026-07-20",
              },
              rulesetVersionsDiffer: false,
              previousRulesetVersion: "test.v1",
              currentRulesetVersion: "test.v1",
            },
          }),
        ],
      }),
    });
    await renderView();

    const notice = await screen.findByTestId("moved-deadline-notice");
    expect(notice.textContent).toContain(
      "Timeline unresolved reason: previous holiday calendar was unavailable; current processing time is unavailable.",
    );
    expect(notice.textContent).not.toContain("previous not calculable; current not calculable");
  });
});

describe("a checklist row whose window comes from another route (#252)", () => {
  const TENT_ROUTE = {
    ruleId: "DOB-TENT-001",
    triggerResult: "unknown",
    disposition: "required",
    unknownFields: ["tent_area_sqft"],
    name: "DOB permit — tent/canopy over 400 gross sq ft or in place 30+ days",
    agency: "DOB",
    deadline: { type: "business_days_minimum" },
    deadlineDisplay: null,
    latestApplyDate: "2026-08-26",
    applyAfterDate: null,
    deadlineStatus: "on_track",
    feeDisplay: "TUP: $100 initial 30 days",
    portalName: null,
    portalUrl: null,
    portalInstructions: null,
  };
  const TALL_ROUTE = {
    ...TENT_ROUTE,
    ruleId: "DOB-TALL-STRUCTURE-001",
    triggerResult: "true",
    disposition: "may_be_required",
    unknownFields: [],
    name: "DOB permit — structure over 10 feet tall",

    deadline: null,
    latestApplyDate: null,
    deadlineStatus: "not_applicable",
    feeDisplay: null,
  };

  const BINDING_WITH_PORTAL = {
    ...TENT_ROUTE,
    portalName: portalNameOf(STREET_MEDIUM),
    portalUrl: portalUrlOf(STREET_MEDIUM),
  };

  it("renders the date and fee, and names the route that publishes them", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-26",
            deadlineStatus: "on_track",
            feeDisplay: "TUP: $100 initial 30 days",
            routes: [TENT_ROUTE, TALL_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: "DOB-TENT-001",
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedCandidateRow();
    expect(within(row).getByText(/apply by 2026-08-26/)).toBeDefined();
    expect(within(row).getByText("TUP: $100 initial 30 days")).toBeDefined();
    expect(
      within(row).getByText(/The published rules give this requirement 2 routes/),
    ).toBeDefined();
    expect(row.textContent).toContain(
      "DOB permit — tent/canopy over 400 gross sq ft or in place 30+ days's.",
    );
  });

  it("says nothing about routes on a row whose window is its own", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { latestApplyDate: "2026-08-26" })],
      }),
    });
    await renderView();

    const row = await expandedRowFor(STREET_MEDIUM);
    expect(within(row).queryByText(/The published rules give this requirement/)).toBeNull();
    expect(within(row).queryByTestId("deciding-question")).toBeNull();
  });

  it("heads a candidate row with the deciding question, not with a candidate's name", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            routes: [TENT_ROUTE, TALL_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const row = candidateRow();
    expect(within(row).getByRole("heading").textContent).toBe(CANDIDATE_HEADING);
    expect(within(row).queryByText(nameOf(STREET_MEDIUM))).toBeNull();

    expect(within(row).getByRole("combobox").getAttribute("aria-label")).not.toContain(
      CANDIDATE_HEADING,
    );
    expect(within(row).getByRole("combobox").getAttribute("aria-label")).not.toContain(
      nameOf(STREET_MEDIUM),
    );
  });

  const DATED_BINDING = {
    ...TALL_ROUTE,
    disposition: "required",
    latestApplyDate: "2026-08-26",
    deadlineStatus: "on_track",
    feeDisplay: "$150 filing fee",
  };

  it("leads a candidate row's citations with the route its paragraph names", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            routes: [DATED_BINDING, TENT_ROUTE],
            headlineMode: "candidate",

            filingRouteRuleId: null,
            sources: [
              {
                ruleId: "DOB-TENT-001",
                citation: "Tent permit page",
                urls: ["https://example.test/tent"],
              },
              {
                ruleId: "DOB-TALL-STRUCTURE-001",
                citation: "Tall structure page",
                urls: ["https://example.test/tall"],
              },
            ],
          }),
        ],
      }),
    });
    await renderView();

    const row = candidateRow();

    expect(row.textContent).toContain(DATED_BINDING.name);
    const promoted = row.querySelector(".check-item__citations a") as HTMLAnchorElement;

    expect(promoted.getAttribute("href")).toBe("https://example.test/tall");
  });

  it("keeps a lone sibling citation reachable when the filing route publishes none", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            routes: [DATED_BINDING, TENT_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: null,

            sources: [
              {
                ruleId: "DOB-TENT-001",
                citation: "Tent permit page",
                urls: ["https://example.test/tent"],
              },
            ],

            publishedNotes: [],
            noteText: null,
            conflictText: null,
            portalName: null,
            portalUrl: null,
            portalInstructions: null,
            timelineUnresolvedReason: null,
            deadlineUnknownFields: [],
          }),
        ],
      }),
    });
    await renderView();

    const row = candidateRow();

    expect(row.querySelector(".check-item__citations")).toBeNull();

    const expanded = await expandRow(row);
    expect(expanded.querySelector('a[href="https://example.test/tent"]')).not.toBeNull();
  });

  it("leads a row's citations with the filing route's own", async () => {
    const source = (ruleId: string, citation: string, url: string) => ({
      ruleId,
      citation,
      urls: [url],
    });
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-26",
            routes: [TENT_ROUTE, TALL_ROUTE],
            headlineMode: "candidate",

            filingRouteRuleId: "DOB-TENT-001",
            sources: [
              source("DOB-TALL-STRUCTURE-001", "Tall structure page", "https://example.test/tall"),
              source("DOB-TENT-001", "Tent permit page", "https://example.test/tent"),
            ],
          }),
        ],
      }),
    });
    await renderView();

    const row = candidateRow();
    const promoted = row.querySelector(".check-item__citations a") as HTMLAnchorElement;
    expect(promoted.getAttribute("href")).toBe("https://example.test/tent");

    const expanded = await expandRow(row);
    expect(expanded.querySelector('a[href="https://example.test/tall"]')).not.toBeNull();
  });

  it("renders every route's official reading on a merged row, each named", async () => {
    const withConflict = (route: Record<string, unknown>, text: string) => ({
      ...route,
      conflictText: text,
    });
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            verificationStatus: "OFFICIAL_CONFLICT",

            conflictText: "the tall route reads the threshold as 10 feet",
            routes: [
              withConflict(DATED_BINDING, "the tall route reads the threshold as 10 feet"),
              withConflict(TENT_ROUTE, "the tent route reads the same threshold as 400 sq ft"),
            ],
            headlineMode: "candidate",
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const details = await expandedCandidateRow();

    expect(details.textContent).toContain("the tall route reads the threshold as 10 feet");
    expect(details.textContent).toContain("the tent route reads the same threshold as 400 sq ft");

    expect(details.textContent).toContain(DATED_BINDING.name);
    expect(details.textContent).toContain(TENT_ROUTE.name);
  });

  it("shows a scalar-free row's gate, which no scalar above it carries", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            permitName: null,
            agency: null,
            deadline: null,
            deadlineDisplay: null,
            latestApplyDate: null,
            applyAfterDate: null,
            deadlineStatus: "not_calculable",
            feeDisplay: null,
            portalName: null,
            portalUrl: null,
            portalInstructions: null,
            routes: [{ ...TENT_ROUTE, applyAfterDate: "2026-07-20" }, TALL_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const row = candidateRow();

    expect(row.textContent).toContain(
      `earliest realistic filing for ${TENT_ROUTE.name} 2026-07-20`,
    );
  });

  it("labels a candidate row's controls after no single route", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            routes: [DATED_BINDING, TENT_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const row = candidateRow();
    for (const control of [within(row).getByRole("combobox"), within(row).getByRole("textbox")]) {
      const label = control.getAttribute("aria-label") ?? "";
      expect(label).not.toContain(nameOf(STREET_MEDIUM));
      expect(label).not.toContain(DATED_BINDING.name);
      expect(label).not.toContain(TENT_ROUTE.name);
      expect(label).toContain("DOB-TALL-STRUCTURE-001");
      expect(label).toContain("DOB-TENT-001");
    }
  });

  it("names the route a candidate row's filing details belong to", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            routes: [DATED_BINDING, TENT_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const row = candidateRow();
    expect(
      within(row).getByText(/The filing date, fee and filing details above are/).textContent,
    ).toContain(DATED_BINDING.name);
  });

  it("names the question that would decide a candidate row", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-26",
            routes: [TENT_ROUTE, TALL_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: "DOB-TENT-001",
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedCandidateRow();
    expect(within(row).getByTestId("deciding-question").textContent).toBe(
      "The answers so far do not say which of the published routes to this requirement apply." +
        " Answering tent area sqft would decide it.",
    );
  });

  it("puts the deciding question ahead of the candidate route's scalars", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-26",
            routes: [TENT_ROUTE, TALL_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: "DOB-TENT-001",
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedCandidateRow();
    const text = row.textContent ?? "";
    const question = text.indexOf("The answers so far do not say");
    const applyBy = text.indexOf("apply by 2026-08-26");
    const attribution = text.indexOf("The published rules give this requirement");
    expect(question).toBeGreaterThanOrEqual(0);
    expect(applyBy).toBeGreaterThanOrEqual(0);
    expect(attribution).toBeGreaterThanOrEqual(0);
    expect(question).toBeLessThan(applyBy);
    expect(question).toBeLessThan(attribution);
  });

  it("says the requirement itself is unsettled when no route has resolved", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-26",
            routes: [
              TENT_ROUTE,
              {
                ...TALL_ROUTE,
                triggerResult: "unknown",
                unknownFields: ["structure_over_10ft_tall"],
              },
            ],
            headlineMode: "candidate",
            filingRouteRuleId: "DOB-TENT-001",
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedCandidateRow();
    expect(within(row).getByTestId("deciding-question").textContent).toBe(
      "The answers so far do not say whether this requirement applies." +
        " Answering tent area sqft, structure over 10ft tall would decide it.",
    );
  });

  it("names the deadline unknowns alongside the trigger unknowns", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-26",
            routes: [TENT_ROUTE, TALL_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: "DOB-TENT-001",
            deadlineUnknownFields: ["structure_types"],
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedCandidateRow();
    expect(within(row).getByTestId("deciding-question").textContent).toBe(
      "The answers so far do not say which of the published routes to this requirement apply." +
        " Answering tent area sqft, structure types would decide it.",
    );
  });

  it("names the portal on a candidate row rather than telling an organizer to apply at it", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            routes: [BINDING_WITH_PORTAL, TALL_ROUTE],
            headlineMode: "candidate",
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedCandidateRow();
    expect(within(row).getByTestId("deciding-question")).toBeDefined();
    expect(within(row).queryByText(/apply at/)).toBeNull();
    expect(within(row).getByText(/portal:/)).toBeDefined();
    expect(
      within(row)
        .getByRole("link", { name: portalNameOf(STREET_MEDIUM) as string })
        .getAttribute("href"),
    ).toBe(portalUrlOf(STREET_MEDIUM));
  });

  it("still says apply at the portal once the row's routes apply together", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            routes: [
              { ...BINDING_WITH_PORTAL, triggerResult: "true", unknownFields: [] },
              TALL_ROUTE,
            ],
            headlineMode: "applies_together",
            filingRouteRuleId: null,
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedRowFor(STREET_MEDIUM);
    expect(within(row).getByText(/apply at/)).toBeDefined();
  });

  it("renders no deciding question when every route resolved", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, {
            latestApplyDate: "2026-08-26",
            routes: [{ ...TENT_ROUTE, triggerResult: "true", unknownFields: [] }, TALL_ROUTE],
            headlineMode: "applies_together",
            filingRouteRuleId: "DOB-TENT-001",
          }),
        ],
      }),
    });
    await renderView();

    const row = await expandedRowFor(STREET_MEDIUM);
    expect(within(row).queryByTestId("deciding-question")).toBeNull();
  });

  it("refuses a checklist response whose route list is empty", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM, { latestApplyDate: "2026-08-26", routes: [] })],
      }),
    });
    await renderView();

    expect(screen.queryByText(STREET_MEDIUM)).toBeNull();
  });

  it("refuses a checklist response whose route list is shorter than a merge", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [
          trackedItem(STREET_MEDIUM, { latestApplyDate: "2026-08-26", routes: [TALL_ROUTE] }),
        ],
      }),
    });
    await renderView();

    expect(screen.queryByText(STREET_MEDIUM)).toBeNull();
  });
});
