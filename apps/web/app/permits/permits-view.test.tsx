// @vitest-environment jsdom

// DEMO SCOPE. What the obtained-permits view tells the organizer, driven through the rendered
// page. Not F-208.
//
// The assertions are about the copy as much as the wiring, because the copy is the part that can
// state a permit fact the product cannot back: an unrecorded value must read as unrecorded, and
// every recorded one must be attributed to the organizer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_DOCUMENT_BYTES } from "../checklist/checklist-api";
import ObtainedPermitsPage from "../events/[id]/permits/page";
import { ObtainedPermitsView } from "./permits-view";

const API = "https://api.example.com";
const EVENT = "event-1";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = { method: string; path: string; body: string | null };

/** A stubbed api. Each entry answers one `METHOD /path` suffix; the calls made are recorded. */
function stubApi(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).slice(API.length);
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: typeof init?.body === "string" ? init.body : null });
    const route = routes[`${method} ${path}`];
    if (route === undefined) throw new Error(`unstubbed ${method} ${path}`);
    return route();
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const permit = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  permitName: "Street Activity Permit",
  agency: "SAPO",
  permitNumber: null,
  issuedOn: null,
  expiresOn: null,
  expired: null,
  notes: null,
  recordedAt: "2026-07-01T10:00:00.000Z",
  documents: [],
  ...overrides,
});

const permitsBody = (items: unknown[], asOf = "2026-07-27") => ({ eventId: EVENT, asOf, items });

const GET_PERMITS = `GET /api/events/${EVENT}/obtained-permits`;

const renderView = () => render(<ObtainedPermitsView apiBaseUrl={API} eventId={EVENT} />);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the obtained permits view", () => {
  it("says nothing is recorded yet when no item is approved", async () => {
    stubApi({ [GET_PERMITS]: () => jsonResponse(200, permitsBody([])) });
    renderView();

    expect(
      await screen.findByText(/You have not marked any permits as approved for this event/),
    ).toBeTruthy();
  });

  it("says a permit number is unrecorded rather than showing one", async () => {
    stubApi({ [GET_PERMITS]: () => jsonResponse(200, permitsBody([permit()])) });
    renderView();

    expect(await screen.findByText("You have not recorded a permit number.")).toBeTruthy();
    expect(screen.getByText("You have not recorded an issue date.")).toBeTruthy();
    expect(screen.getByText("You have not recorded an expiry date.")).toBeTruthy();
    // The approval is the organizer's own record, never an agency's decision.
    expect(screen.getByText(/You marked this as approved\./)).toBeTruthy();
  });

  it("states an expired permit in words, with the date and the day it is judged against", async () => {
    stubApi({
      [GET_PERMITS]: () =>
        jsonResponse(
          200,
          permitsBody([permit({ expiresOn: "2026-05-01", expired: true })], "2026-07-27"),
        ),
    });
    renderView();

    expect(
      await screen.findByText(
        "The expiry date you recorded, 2026-05-01, has passed as of 2026-07-27.",
      ),
    ).toBeTruthy();
  });

  it("shows a recorded number, issue date and unexpired expiry as the organizer's own values", async () => {
    stubApi({
      [GET_PERMITS]: () =>
        jsonResponse(
          200,
          permitsBody([
            permit({
              permitNumber: "SAPO-2026-4471",
              issuedOn: "2026-01-05",
              expiresOn: "2027-01-04",
              expired: false,
              notes: "Collected at the precinct.",
            }),
          ]),
        ),
    });
    renderView();

    expect(await screen.findByText("Permit number you recorded: SAPO-2026-4471")).toBeTruthy();
    expect(screen.getByText("You recorded an issue date of 2026-01-05.")).toBeTruthy();
    expect(screen.getByText("You recorded an expiry date of 2027-01-04.")).toBeTruthy();
    expect(screen.getByText("Your notes: Collected at the precinct.")).toBeTruthy();
  });

  it("saves the details the organizer types and re-reads the record", async () => {
    let saved = false;
    const calls = stubApi({
      [GET_PERMITS]: () =>
        jsonResponse(
          200,
          permitsBody([saved ? permit({ permitNumber: "A-1", issuedOn: "2026-03-04" }) : permit()]),
        ),
      [`PATCH /api/checklist-items/item-1/permit-record`]: () => {
        saved = true;
        return jsonResponse(200, { id: "item-1" });
      },
    });
    renderView();

    await userEvent.click(await screen.findByRole("button", { name: /Edit recorded details/ }));
    await userEvent.type(screen.getByLabelText("Permit number"), "A-1");
    await userEvent.type(screen.getByLabelText("Issue date"), "2026-03-04");
    await userEvent.click(screen.getByRole("button", { name: "Save recorded details" }));

    expect(await screen.findByText("Permit number you recorded: A-1")).toBeTruthy();
    const patch = calls.find((call) => call.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "null")).toEqual({
      permitNumber: "A-1",
      issuedOn: "2026-03-04",
      expiresOn: null,
    });
  });

  it("reports a save that failed and keeps the form open", async () => {
    stubApi({
      [GET_PERMITS]: () => jsonResponse(200, permitsBody([permit()])),
      [`PATCH /api/checklist-items/item-1/permit-record`]: () =>
        jsonResponse(400, { error: "issuedOn and expiresOn must be YYYY-MM-DD dates or null" }),
    });
    renderView();

    await userEvent.click(await screen.findByRole("button", { name: /Edit recorded details/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save recorded details" }));

    expect(
      await screen.findByText("issuedOn and expiresOn must be YYYY-MM-DD dates or null"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save recorded details" })).toBeTruthy();
  });

  it("uploads an attached document and then resolves its signed download link", async () => {
    let uploaded = false;
    stubApi({
      [GET_PERMITS]: () =>
        jsonResponse(
          200,
          permitsBody([
            uploaded
              ? permit({ documents: [{ id: "doc-1", filename: "permit.pdf" }] })
              : permit(),
          ]),
        ),
      [`POST /api/checklist-items/item-1/documents`]: () => {
        uploaded = true;
        return jsonResponse(201, { id: "doc-1", filename: "permit.pdf" });
      },
      "GET /api/documents/doc-1/url": () =>
        jsonResponse(200, { url: "https://storage.test/permit.pdf?sig=1" }),
    });
    renderView();

    await userEvent.click(await screen.findByRole("button", { name: /Edit recorded details/ }));
    await userEvent.upload(
      screen.getByLabelText("Attach the permit document"),
      new File(["%PDF-1.7"], "permit.pdf", { type: "application/pdf" }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Get download link for permit.pdf" }),
    );
    const link = await screen.findByRole("link", { name: "Download permit.pdf" });
    expect(link.getAttribute("href")).toBe("https://storage.test/permit.pdf?sig=1");
  });

  it("refuses a file the api would refuse, before uploading it", async () => {
    const calls = stubApi({ [GET_PERMITS]: () => jsonResponse(200, permitsBody([permit()])) });
    renderView();

    await userEvent.click(await screen.findByRole("button", { name: /Edit recorded details/ }));
    // Over the api's size limit. The type is one the picker accepts, so the file reaches the
    // handler rather than being filtered out by `accept` before it is ever seen.
    await userEvent.upload(
      screen.getByLabelText("Attach the permit document"),
      new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "permit.pdf", {
        type: "application/pdf",
      }),
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("says the permits could not be read rather than showing an empty list", async () => {
    stubApi({ [GET_PERMITS]: () => jsonResponse(500, { error: "obtained permits request failed" }) });
    renderView();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/You have not marked any permits/)).toBeNull();
  });

  it("refuses a response it cannot read field by field", async () => {
    stubApi({
      [GET_PERMITS]: () => jsonResponse(200, permitsBody([permit({ permitNumber: 7 })])),
    });
    renderView();

    expect(
      await screen.findByText("The API returned permits this page cannot read."),
    ).toBeTruthy();
  });

  it("says the api could not be reached when the request never gets an answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    renderView();

    expect(await screen.findByText(/The API could not be reached/)).toBeTruthy();
  });

  it("reports a failed upload and a failed download link without changing the record", async () => {
    stubApi({
      [GET_PERMITS]: () =>
        jsonResponse(
          200,
          permitsBody([permit({ documents: [{ id: "doc-1", filename: "permit.pdf" }] })]),
        ),
      "POST /api/checklist-items/item-1/documents": () =>
        jsonResponse(503, { error: "document storage is unavailable" }),
      "GET /api/documents/doc-1/url": () => jsonResponse(404, { error: "document not found" }),
    });
    renderView();

    await userEvent.click(
      await screen.findByRole("button", { name: "Get download link for permit.pdf" }),
    );
    expect(await screen.findByText("document not found")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Edit recorded details/ }));
    await userEvent.upload(
      screen.getByLabelText("Attach the permit document"),
      new File(["%PDF-1.7"], "permit.pdf", { type: "application/pdf" }),
    );
    expect(await screen.findByText("document storage is unavailable")).toBeTruthy();
  });

  it("refuses a payload whose shape it cannot read at all", async () => {
    stubApi({ [GET_PERMITS]: () => jsonResponse(200, { eventId: EVENT, items: [] }) });
    renderView();

    expect(await screen.findByText("The API returned permits this page cannot read.")).toBeTruthy();
  });

  it("names the item plainly when the plan carries no permit name", async () => {
    stubApi({
      [GET_PERMITS]: () =>
        jsonResponse(200, permitsBody([permit({ permitName: null, agency: null })])),
    });
    renderView();

    expect(await screen.findByText("Unnamed checklist item")).toBeTruthy();
    expect(screen.queryByText(/^Agency:/)).toBeNull();
  });

  it("renders through the route with the configured api base url", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = API;
    stubApi({ [GET_PERMITS]: () => jsonResponse(200, permitsBody([])) });

    render(await ObtainedPermitsPage({ params: Promise.resolve({ id: EVENT }) }));

    expect(
      await screen.findByText(/You have not marked any permits as approved for this event/),
    ).toBeTruthy();
  });
});
