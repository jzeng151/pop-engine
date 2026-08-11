import type { MigrationBuilder } from "node-pg-migrate";
import { describe, expect, it, vi } from "vitest";
import { down, up } from "../../migrations/015_event_create_idempotency";

describe("migration 015", () => {
  it("adds a paired durable request key and body with one unique key", () => {
    const addColumns = vi.fn();
    const addConstraint = vi.fn();
    const createIndex = vi.fn();
    up({ addColumns, addConstraint, createIndex } as unknown as MigrationBuilder);

    expect(addColumns).toHaveBeenCalledWith("events", {
      create_idempotency_key: { type: "uuid" },
      create_request_body: { type: "jsonb" },
    });
    expect(addConstraint).toHaveBeenCalledWith("events", "events_create_request_pair", {
      check: "(create_idempotency_key IS NULL) = (create_request_body IS NULL)",
    });
    expect(createIndex).toHaveBeenCalledWith("events", "create_idempotency_key", {
      name: "events_create_idempotency_key_unique",
      unique: true,
    });
  });

  it("removes only migration 015's index, constraint, and columns", () => {
    const dropIndex = vi.fn();
    const dropConstraint = vi.fn();
    const dropColumns = vi.fn();
    down({ dropIndex, dropConstraint, dropColumns } as unknown as MigrationBuilder);

    expect(dropIndex).toHaveBeenCalledWith("events", "create_idempotency_key", {
      name: "events_create_idempotency_key_unique",
    });
    expect(dropConstraint).toHaveBeenCalledWith("events", "events_create_request_pair");
    expect(dropColumns).toHaveBeenCalledWith("events", [
      "create_idempotency_key",
      "create_request_body",
    ]);
  });
});
