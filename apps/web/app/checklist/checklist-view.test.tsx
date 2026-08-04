// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChecklistPage from "../events/[id]/checklist/page";
import PlanPage from "../events/[id]/plan/page";
import { publishedRulesFileIn } from "../rules-file";
import { ChecklistView } from "./checklist-view";
import { NOT_COVERED_BY_RULESET } from "../verification-copy";
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

// One test per acceptance criterion and per edge case, driven through the rendered view: what is
// pinned is what an organizer can do and what they are told, not the shape of the state machine.
//
// Every regulatory value asserted below is read from the published ruleset through the fixtures,
// never written out here. A test that spells out a permit name or a fee is asserting that the page
// renders a string the test itself invented, which is how the first round of this suite passed 107
// times against a fee that was wrong by three orders of magnitude.

const API = "https://api.example.com";
const EVENT = "event-1";

type Route = { method: string; url: string };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A stubbed api. Each entry answers one `METHOD /path` suffix; the calls made are recorded. */
function stubApi(routes: Record<string, () => Response>) {
  const calls: Route[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const route = Object.entries(routes).find(
      ([key]) => key === `${method} ${url.slice(API.length)}`,
    );
    // Every render reads the live ruleset for the banner's live-versus-pinned comparison. Tests
    // that do not care about it get the checklist's own version back, which compares as "same"
    // and renders nothing extra.
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

/** Checklist reads only: the banner's `/api/rules/meta` lookup is not a re-read of the list. */
const checklistReads = (calls: Route[]): Route[] =>
  calls.filter((call) => call.method === "GET" && call.url.endsWith("/checklist"));

const checklistOf = (overrides: Record<string, unknown>) => () =>
  jsonResponse(200, checklistBody(overrides));

/**
 * A rollup as the api counts it: current-plan rows only. Written here so a test states the
 * SERVER's answer and the page is asserted against it, rather than against a second
 * implementation of the counting rule living in the client (AC 2).
 */
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

/** The row for a named requirement, so multi-row assertions cannot read the wrong card. */
const rowFor = (ruleId: string) => screen.getByRole("article", { name: nameOf(ruleId) });

/**
 * One row with its detail expanded when it has any.
 *
 * The row is progressively disclosed: the summary carries the status badge, agency, disposition,
 * the deadline including `apply_after_date` (F-202 AC 5 requires it here even though the plan line
 * keeps it behind the expand), the fee, the verification badge and the primary citation. These
 * cases assert a field renders with the right content, which the split does not change, so the
 * helper opens the panel first.
 */
const expandedRowFor = async (ruleId: string): Promise<HTMLElement> => {
  const row = rowFor(ruleId);
  const toggle = within(row).queryByRole("button", { name: /^Details for/ });
  if (toggle !== null) await userEvent.click(toggle);
  return row;
};

/**
 * The status badge on a row. Read by class rather than by text: the status control lists every
 * status as an option, so "submitted" as text matches the badge and the option alike.
 */
const badgeOf = (row: HTMLElement): string | undefined =>
  row.querySelector(".check-item__status")?.textContent ?? undefined;

/**
 * A stand-in for the tab a download opens. `window.open` is not implemented in jsdom, and the
 * handle is the whole point of the fix: the page has to navigate the tab it opened.
 */
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

  // The rollup is the api's count, re-read after the write, so the counts and the rows on screen
  // always come from one response and one implementation of the rule.
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
    // One PATCH, then one re-read: the page never counts the rows itself.
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(checklistReads(calls)).toHaveLength(2);
  });

  it("renders the counts the api sent, not a count of its own", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        // Deliberately not derivable from the rows below: what is on screen is the server's
        // answer, so a client that recomputed it would fail this.
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

    // The third row is visible below and accounted for here, so the rollup never reads as though
    // it had dropped a row the organizer can see.
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

  // The write landed; only the re-read did not. Reporting it as a failed save would be wrong
  // about what happened, and saying nothing would leave stale counts looking current.
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

  // The tab is opened on the click and navigated when the URL arrives. Opening it after the await
  // is refused once the click's transient activation has expired, and `noopener` makes
  // `window.open` return null unconditionally — both leave the button doing nothing.
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
    // Opened with a real handle, and the back-reference severed by hand, which is what
    // `noopener` would have done had it not also thrown the handle away.
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

  // Edge case: upload failure keeps the item's state and leaves no orphan metadata, so the same
  // file stays selected and the error says the upload can be tried again.
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
    // The item is untouched: same status, and no document appeared.
    expect(badgeOf(row)).toBe("submitted");
    expect(within(row).queryByRole("button", { name: "Download" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Upload" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  // The connection dropped with no response. That is NOT the same as nothing being stored: the
  // request may have been processed and committed before the drop, and the api mints a fresh
  // document id and storage key per request, so a one-click resend would store a second copy.
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
    // Reconciled rather than guessed: the list itself is the answer, and it is re-read.
    expect(checklistReads(calls)).toHaveLength(2);
    // The file stays selected and Upload stays live, which is now the RIGHT affordance rather
    // than a hazard: the api derives the document id from the upload key, so sending the same
    // file again is the same document. Clearing it used to be the guard; the guard moved to the
    // write, where a client that cannot observe its own request no longer has to.
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

  // The document is stored; only the re-read failed. Inviting a retry would store a second copy.
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

    // Nothing stored, so the file stays selected — but the copy does not invite a retry that
    // would be refused identically. It states what happened and leaves the decision alone.
    expect((await screen.findByRole("alert")).textContent).toBe(
      "document must be 10485760 bytes or smaller Nothing was stored, so the file is still selected.",
    );
  });

  it("refuses a type the api would refuse, without sending it", async () => {
    const calls = stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(STREET_MEDIUM)] }),
    });
    await renderView();

    // The picker's `accept` already filters this out in a browser; the check is asserted here
    // because the file input is not the only way a file can arrive, and the api refuses it too.
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

  it("renders the deadline prose a rule publishes", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(PARKS_TUA)] }),
    });
    await renderView();

    // PARKS-TUA-001 publishes its own `display`; the row shows the published words, not a
    // sentence this page composed from the day count.
    expect(
      within(rowFor(PARKS_TUA)).getByText("submit vendor info at least two weeks prior"),
    ).toBeDefined();
  });

  it("renders the published deadline type for a rule that states nothing else", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({ created: true, items: [trackedItem(INSURANCE)] }),
    });
    await renderView();

    // SAPO-INSURANCE-001 publishes `{type: "before_issuance"}` and no date, prose or portal.
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
    // The dependency rule's published note is what says the sequencing is unconfirmed.
    expect(within(row).getByText(noteTextOf(SOUND_DEPENDENCY) as string)).toBeDefined();
    // A line with no located primary source says so on the row, not in a tooltip.
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

    // NYPD-SOUND-001 publishes a precinct and a form number instead of a URL, and that text is
    // the entire filing route for the row (F-204 AC 1).
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

    // SAPO-STREET-MEDIUM-001 publishes two source pages; each gets its own numbered link.
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
    // Both readings, verbatim, never resolved to one.
    expect(within(row).getByText(noteTextOf(PARKS_TUA) as string)).toBeDefined();
    // And every page the two readings come from.
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

    // ADV-ALCOHOL-PUBLIC-001 publishes no `source` at all; COVERAGE_GAP means the combination is
    // not modeled (published legend), not that a source search failed.
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
        // No published rule carries `verification.last_verified_date`, so the fixture states one
        // explicitly: this is a per-plan-item stored value, and the render is what is under test.
        items: [trackedItem(STREET_MEDIUM, { lastVerifiedDate: "2026-07-01" })],
        contextItems: [planContext(NOISE_ADVISORY, { lastVerifiedDate: "2026-06-15" })],
      }),
    });
    await renderView();

    expect(within(rowFor(STREET_MEDIUM)).getByText("last verified 2026-07-01")).toBeDefined();
    // Context rows carry it too: it is a property of the plan item, not of being trackable.
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
    // And specifically not the snapshot's publication date: a snapshot date means published-on,
    // never all-facts-verified-on, so standing it in here would state a verification that never
    // happened.
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
    // Nothing was deleted: the status, the note and the document are all still on the row.
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

    // The new requirement is appended and the dropped one is still there, struck through.
    expect(await screen.findByRole("heading", { name: nameOf(SOUND) })).toBeDefined();
    expect(rowFor(STREET_LARGE).className).toContain("check-item--dropped");
    expect(screen.queryByText(/The plan has changed/)).toBeNull();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  // The review button and the item controls are both live while planChanged is true, so a status
  // change can commit and render while the conversion POST is in flight. Installing that POST's
  // own body put the status it read BEFORE the update, and the counts that went with it, back on
  // screen. The conversion now goes through the same epoch-ordered re-read as every other write.
  it("does not install the conversion's own response over a newer item update", async () => {
    const calls = stubApi({
      // What the server holds now: the organizer's status change has already landed.
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: true,
        statusRollup: rollupOf({ submitted: 1 }),
        items: [trackedItem(STREET_MEDIUM, { status: "submitted" })],
      }),
      // What the conversion answers with: assembled before that change, so it is already stale.
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

    // The symptom first: the organizer's status must not revert to what the conversion read.
    await waitFor(() => expect(badgeOf(rowFor(STREET_MEDIUM))).toBe("submitted"));
    expect(document.querySelector(".checklist__rollup")?.textContent).toBe("1 submitted");
    // And the mechanism: the conversion re-read rather than installing its own body.
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
    // The case that was broken: nothing to convert, so the inputs and the only button that
    // submits them were both gone. An organizer who mistyped an address had no product flow to
    // correct it, and the alerts already scheduled kept retrying the unusable one.
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: false,
        items: [trackedItem()],
        alertContacts: { email: "typo@example.test", phone: null },
      }),
    });

    await renderView();

    // Seeded from the store, so the organizer edits what is actually on file.
    expect(screen.getByLabelText<HTMLInputElement>("Email for deadline reminders").value).toBe(
      "typo@example.test",
    );
    // Named for what pressing it does here: there is nothing to review.
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
    // THE ENTRY POINT TO EVERYTHING THE CONTACT WORK BUILT. The POST's response is assembled
    // before the alerts it just scheduled have been attempted, so the poller can only record a
    // failure after that state is on screen. With no reload path the warning never appeared, and
    // an organizer who is never told there is a problem never corrects the address that caused it.
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

      // The poller runs and the send fails, which happens entirely after the render above.
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
    // With no address the api schedules nothing and says so, so there is no later delivery whose
    // failure could arrive. Re-reading anyway would be this page polling for a fact that cannot
    // change, which is the general behaviour the bounded version was chosen over.
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
    // Both contact columns are nullable and the scheduler only takes channels that have a
    // destination, so phone-only is a supported configuration in which NO email alert is scheduled.
    // The unconditional sentence reassured that organizer about a delivery path they do not have,
    // which is the worst version of it: read by exactly the person for whom it is false.
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
    // The number is still stored rather than refused, because the schema permits phone-only.
    expect(lede.textContent).toContain("stored for when text sending is switched on");
    expect((screen.getByLabelText("Mobile number (optional)") as HTMLInputElement).value).toBe(
      "+15550000000",
    );
  });

  it("says where reminders are addressed without promising they arrive", async () => {
    // The other half, so the fix cannot be written as "never mention email". This is the sentence
    // the phone field exists to qualify, and it is true whenever an address is set.
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        planChanged: false,
        alertContacts: { email: "organizer@example.test", phone: null },
      }),
    });

    await renderView();

    // ROUTING, NOT ARRIVAL. The page cannot see whether Resend is configured — the checklist
    // response reports contacts and rows and nothing about provider credentials — so a promise that
    // reminders GO to the email is one it cannot keep in the supported unconfigured configuration.
    // Where they are ADDRESSED is settled by the contacts alone.
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
    // F-203 exists so a filing deadline does not pass unnoticed. An alert failing silently is
    // exactly that failure, and until this nothing on any surface said so.
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
    // The action it points at is really there, because contacts stay editable on a current
    // checklist.
    expect(screen.getByLabelText("Email for deadline reminders")).toBeDefined();
  });

  it("does not claim retries are running while the plan is stale", async () => {
    // Round 14 made the api HOLD alerts whose plan the event has been edited past, so it cannot
    // send a filing date the current event does not have. The count still reports those rows, and
    // the notice went on saying PopEngine keeps retrying them, which stopped being true for as
    // long as the organizer takes to regenerate.
    //
    // Qualified rather than hidden: dropping the rows would leave an organizer with failed alerts
    // and no sign of them, which is the silence this notice exists to break. Correcting the
    // address, which the ordinary sentence points at, does nothing until the plan is current, so
    // the paused version names the action that actually resumes delivery.
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

  it("does not turn an unknown delivery outcome into a definite non-delivery", async () => {
    // A provider timeout or a lost response is recorded as failed while the message MAY have
    // arrived, which is the whole reason this feature hands the provider an idempotency key and
    // retries. Saying the alerts "failed to send" and "have not gone out" converted an unknown
    // outcome into a definite one. The page cannot tell a rejection from a lost answer, because
    // the reason lives in payload.last_error and is deliberately never sent to a client, so
    // unconfirmed is the strongest thing that is true here.
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
    // planStale describes the NEWEST plan. Between a regeneration and a review that is false while
    // the failed rows still point at the old revision and stay unclaimable, so the copy promised
    // retries that were paused. The api answers it from the plans those rows hang off.
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
    // An empty count is not evidence the channel works: nothing may have been attempted. This is
    // the same overclaim as the "email is fine" line that was removed, so it must not come back
    // as a positive rendered from an absence.
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: true, failedAlertDeliveries: [] }) });

    await renderView();

    expect(screen.queryByText(/not been confirmed as delivered/)).toBeNull();
    expect(screen.queryByText(/working|delivering|sent normally/)).toBeNull();
  });

  it("tells the organizer when delivery has stopped rather than paused or continued", async () => {
    // THE DISTINCTION THIS PAGE COULD NOT DRAW. An alert the poller has permanently stopped on
    // reached the organizer either as nothing at all (a crash leaves it pending) or as an ordinary
    // failure under copy saying PopEngine keeps retrying it. Both told them delivery was in hand.
    // The one thing this notice has to make possible is telling "still trying" from "stopped, and
    // a person has to do something", so the words say which of those it is and name the action.
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
        "time has passed to try them again safely, so PopEngine has stopped: nothing on their " +
        "current schedule will send them again while they stay recorded this way. Someone has to " +
        "check with the sending service whether they went out, and what that check records " +
        "decides whether this schedule sends them after all; until then, do not count on them to " +
        "remind you of the filing dates they cover.",
    );
    expect(notice.getAttribute("role")).toBe("alert");
    // The claim that broke this: nothing here may promise a retry that is not going to happen.
    expect(notice.textContent).not.toContain("keeps retrying");
  });

  it("does not promise a held alert can never be sent again", async () => {
    // WHAT THIS NOTICE IS NOT ENTITLED TO SAY. A held alert is cancelled by a regeneration and
    // revived by the next review as a FRESH schedule: the revival supersedes the unresolved
    // attempt, and the poller then sends the same alert again — which may be the second copy of a
    // delivery nobody ever observed. Told flatly that these alerts "will not be sent again", an
    // organizer who regenerates their plan gets exactly the duplicate the sentence ruled out. The
    // page cannot see whether a regeneration is coming, so it says what it can see: the schedule
    // these alerts are on now is not going to send them.
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
    // THE EXIT FROM THE HOLD, which this notice was writing as if it did not exist. Checking with
    // the sending service is the action the last sentence asks for, and one of its two answers is
    // that no message is there: the operator then clears or resolves the unresolved attempt, and
    // the alert — still pending or failed, still on the same send_at — is sent by the next poll.
    // No cancellation and no regeneration are involved, so "nothing on their current schedule will
    // send them again" was false about the very outcome the notice is steering towards. It is true
    // only while the attempt stays as it is, and the copy has to say which.
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        alertsHeldForReconciliation: [{ channel: "email", heldCount: 2 }],
      }),
    });

    await renderView();

    const notice = screen.getByText(/no outcome ever came back/);
    expect(notice.textContent).toContain(
      "nothing on their current schedule will send them again while they stay recorded this way",
    );
    // And the check is named as what can change that, rather than only as an errand.
    expect(notice.textContent).toMatch(/what that check records decides whether/);
    // The promise this notice may not make in an unqualified form.
    expect(notice.textContent).not.toMatch(/will send them again\./);
  });

  it("does not assert a handoff it cannot prove happened", async () => {
    // THE WEAKEST CASE THIS ONE STRING HAS TO BE TRUE OF. The attempt is recorded BEFORE the
    // provider is called, on its own connection, precisely so a process that dies mid-send leaves
    // evidence. A process that dies just after that record and before the sender runs leaves the
    // same evidence with nothing handed over at all, and after downtime longer than the dedup
    // window that row becomes a hold. Told flatly that the alert was handed to the sending
    // service, an organizer goes to reconcile a message the provider may never have seen — and on
    // a filing deadline that is a claim the page has no evidence for. Every clause has to hold in
    // that case, not only in the one where the send really did go out.
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
    // Nor may the action presume the message reached anybody: what a person checks is whether
    // anything went out, which is the question this state leaves open.
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
        "time has passed to try it again safely, so PopEngine has stopped: nothing on its " +
        "current schedule will send it again while it stays recorded this way. Someone has to " +
        "check with the sending service whether it went out, and what that check records decides " +
        "whether this schedule sends it after all; until then, do not count on it to remind you " +
        "of the filing date it covers.",
    );
  });

  it("says nothing when no alert is stopped", async () => {
    // Same rule as every other notice on this page: an absence is not evidence of health, so
    // nothing is rendered from one.
    stubApi({ [GET_CHECKLIST]: checklistOf({ created: true, alertsHeldForReconciliation: [] }) });

    await renderView();

    expect(screen.queryByText(/no outcome ever came back/)).toBeNull();
  });

  it("keeps a stopped alert and a retrying failure as separate statements", async () => {
    // The two can be true of one event at once, on the same channel: one alert lost its answer a
    // day ago and another failed a minute ago. Collapsing them would put the wrong sentence on
    // one of the two, which is the defect this notice exists to correct.
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
    // "Not switched on yet" and "tried and did not arrive" are different facts. Collapsing them
    // would misreport both.
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
    // Neither sentence borrows the other's claim.
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

    // The organizer's version of the fact, not the operator's: no provider name, no open-question
    // id, and the correction first — what they were counting on did not arrive.
    const notice = screen.getByText(/No text messages have been sent\./);
    expect(notice.textContent).toBe(
      "No text messages have been sent. PopEngine recorded 2 text message alerts for this event, " +
        "but text message sending is not switched on yet, so nothing was delivered.",
    );
    // And no "email is fine" reassurance: nothing in this response says whether it is, and email
    // is only live when Resend is configured. Pointing at a second channel that may be equally
    // silent is the same overclaim as calling the simulated one delivered.
    expect(notice.textContent).not.toContain("Email alerts are sent normally");
    // Loud enough not to be missed, like the other things that change what can be relied on.
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
    // A real delivery must not pick up a "nothing was delivered" caveat by accident.
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
    // An unrecognised channel still has to be reported: the point of the notice is that something
    // did not arrive, and silence about it is the one answer that cannot be right.
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
  // F-206 AC 4, as amended for SPEC-CONFLICT #115. The api decides which plan a row reads; what
  // is pinned here is that the pair is rendered off the row and never assembled from two sources.
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
            // A superseded published version, paired with the date that version carried.
            sourcePlan: { rulesetVersion: "nyc.v2.5", snapshotDate: "2026-06-01" },
          }),
        ],
      }),
    });
    await renderView();

    // The pair travels together: this version beside the banner's date would be a combination
    // that never existed on any artifact.
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

  // The live rules file is read, for one thing only: how the live ruleset stands against the one
  // this checklist's plan pinned (F-206 AC 4 — `/api/rules/meta` "is not the plan banner's
  // source"). None of the displayed provenance values may come from it.
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
    // The pair is the plan's, paired with each other and with nothing else.
    expect(banner.textContent).toContain("Rules snapshot nyc.v2.5");
    expect(banner.textContent).toContain("published June 1, 2026");
    expect(banner.textContent).not.toContain("December 31, 2026");
    // The row's own provenance is the row's, not the live file's.
    expect(screen.getByText(/Dates from rules snapshot nyc\.v2\.1/)).toBeDefined();
    // The live version appears only where it belongs: naming the newer ruleset that exists.
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

    // The banner says "regenerate to update" and regenerating is the plan view's action, so the
    // page says where it lives rather than leaving an organizer to find it.
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
    // The context is there, read-only: no status, no notes, no upload.
    const context = rowFor(ALCOHOL_ADVISORY);
    expect(within(context).queryByRole("combobox")).toBeNull();
    expect(within(context).queryByRole("textbox")).toBeNull();
    expect(within(context).queryByRole("button")).toBeNull();
  });

  it("renders advisories as context beside trackable rows, never as tasks", async () => {
    stubApi({
      [GET_CHECKLIST]: checklistOf({
        created: true,
        items: [trackedItem(STREET_MEDIUM)],
        contextItems: [planContext(NOISE_ADVISORY)],
      }),
    });
    await renderView();

    expect(screen.getByRole("region", { name: "Read-only context" })).toBeDefined();
    expect(within(rowFor(NOISE_ADVISORY)).queryByRole("combobox")).toBeNull();
    expect(within(rowFor(STREET_MEDIUM)).getByRole("combobox")).toBeDefined();
  });

  // Edge case: created twice is idempotent. Two ways round: the api answers the second call 200
  // with the checklist that already exists, and the page cannot send a second call while the
  // first is in flight.
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
    // The stale tab, from the organizer's side. This page rendered plan-2 and the api refuses the
    // review because plan-3 arrived meanwhile. The refusal must not read as "your click failed":
    // nothing was recorded, and the plan they now have to review has to be the one on screen.
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
        // The regeneration lands: from here the page reads the newer plan.
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

    // Told plainly that the click filed nothing, rather than being left to assume it did.
    await waitFor(() => expect(screen.getByText(/nothing was recorded/i)).toBeTruthy());
    // And looking at the plan they are being asked to review, not the one that was refused.
    expect(screen.getAllByRole("heading", { name: nameOf(STREET_LARGE) })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: nameOf(STREET_MEDIUM) })).toBeNull();
    // The review button is still there: this is a retry, not a dead end.
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

    // A portal with a URL but no published name is linked by its URL rather than left unlinked.
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
    // The first event's checklist must never be read under the second event's id.
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
  // AC 1's "one click" needs somewhere to click from, and after generating a plan the organizer
  // is on the plan route. Before this, nothing in `apps/web/app` linked to the checklist, so the
  // conversion step and the Scenario A demo path were reachable only by typing the URL.
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
    // Neither an advisory nor a permit is captioned for a null fee. A finding cannot tell "this
    // filing has no fee" from "the amount was not published" — both arrive as null — and reading it
    // off the row's KIND only relocates the guess to what other rules of that kind publish. So the
    // row says nothing, which is the one thing the data supports.
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
    // The withdrawal is of the CAPTION, not of the fee: an amount that exists still renders.
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
    // `lastVerifiedDate` renders in the row's SUMMARY, so it must not open the panel: it used to be
    // listed as detail, and a row carrying only that date rendered a control over an empty panel.
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
    // And the date it carries is on the row regardless, not lost with the control.
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
