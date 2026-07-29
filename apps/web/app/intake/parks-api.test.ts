import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverParks, parksBoroughCode } from "./parks-api";

const jsonResponse = (status: number, body: unknown): Response => Response.json(body, { status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NYC Parks browser client", () => {
  it("maps every intake borough slug to the Parks API code", () => {
    expect(
      ["manhattan", "brooklyn", "queens", "bronx", "staten_island"].map(parksBoroughCode),
    ).toEqual(["M", "B", "Q", "X", "R"]);
    expect(parksBoroughCode("outside_nyc")).toBeNull();
    expect(parksBoroughCode(null)).toBeNull();
  });

  it("uses credentialed fetch and accepts only the mapped response shape", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        status: "SUCCESS",
        spaces: [
          {
            locationId: "B073-EVENTAREA-1",
            parkName: "Prospect Park",
            borough: "B",
            type: "Whole Park",
            acres: "500",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      discoverParks("https://api.example.com", "B", "Prospect", signal),
    ).resolves.toEqual({
      ok: true,
      spaces: [
        {
          locationId: "B073-EVENTAREA-1",
          parkName: "Prospect Park",
          borough: "B",
          type: "Whole Park",
          acres: "500",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/permits/nyc/discover?borough=B&name=Prospect&limit=20",
      { credentials: "include", signal },
    );
  });

  it("reports HTTP, non-JSON, and malformed success responses without throwing", async () => {
    const signal = new AbortController().signal;
    for (const response of [
      jsonResponse(502, { error: "unavailable" }),
      new Response("<html>bad gateway</html>", { status: 200 }),
      jsonResponse(200, {
        status: "SUCCESS",
        spaces: [{ parkName: "Missing fields" }],
      }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(discoverParks("https://api.example.com", "Q", "Park", signal)).resolves.toEqual({
        ok: false,
        message: "Park suggestions are unavailable.",
      });
    }
  });
});
