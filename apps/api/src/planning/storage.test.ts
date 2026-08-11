import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachmentDisposition,
  DocumentStorageError,
  createS3DocumentStorage,
  s3ClientFor,
  s3SettingsFromEnv,
  unconfiguredDocumentStorage,
} from "./storage";

const SETTINGS = {
  endpoint: "https://project-ref.supabase.co/storage/v1/s3",
  region: "us-east-1",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "pop-engine-documents",
};

const PDF = Buffer.from("%PDF-1.7 synthetic");
const pdfStream = (): Readable => Readable.from(PDF);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S3 settings from the environment", () => {
  it("reads the five variables DEPLOY.md provisions", () => {
    expect(
      s3SettingsFromEnv({
        S3_ENDPOINT: SETTINGS.endpoint,
        S3_REGION: SETTINGS.region,
        S3_ACCESS_KEY_ID: SETTINGS.accessKeyId,
        S3_SECRET_ACCESS_KEY: SETTINGS.secretAccessKey,
        S3_BUCKET: SETTINGS.bucket,
      }),
    ).toEqual(SETTINGS);
  });

  it("reports storage as unconfigured when any one of them is missing", () => {
    const complete = {
      S3_ENDPOINT: SETTINGS.endpoint,
      S3_REGION: SETTINGS.region,
      S3_ACCESS_KEY_ID: SETTINGS.accessKeyId,
      S3_SECRET_ACCESS_KEY: SETTINGS.secretAccessKey,
      S3_BUCKET: SETTINGS.bucket,
    };
    for (const missing of Object.keys(complete)) {
      expect(s3SettingsFromEnv({ ...complete, [missing]: undefined })).toBeNull();
    }
    expect(s3SettingsFromEnv({})).toBeNull();
  });
});

describe("S3-compatible document storage", () => {
  it("puts the object under the given key with its declared content type and length", async () => {
    const client = s3ClientFor(SETTINGS);
    const send = vi.spyOn(client, "send").mockResolvedValue(undefined as never);
    const storage = createS3DocumentStorage(client, SETTINGS.bucket);

    const body = pdfStream();
    await storage.put("checklist-items/abc/def.pdf", body, "application/pdf", PDF.byteLength);

    expect(send).toHaveBeenCalledTimes(1);

    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: SETTINGS.bucket,
      Key: "checklist-items/abc/def.pdf",
      Body: body,
      ContentType: "application/pdf",
      ContentLength: PDF.byteLength,
    });
  });

  it("signs a path-style download url that expires with the requested lifetime", async () => {
    const storage = createS3DocumentStorage(s3ClientFor(SETTINGS), SETTINGS.bucket);

    const url = new URL(
      await storage.signedDownloadUrl("checklist-items/abc/def.pdf", 300, "permit.pdf"),
    );

    expect(url.origin).toBe("https://project-ref.supabase.co");
    expect(url.pathname).toBe("/storage/v1/s3/pop-engine-documents/checklist-items/abc/def.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);

    expect(url.search).not.toContain(SETTINGS.secretAccessKey);

    expect(url.searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="permit.pdf"; filename*=UTF-8''permit.pdf`,
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).not.toBeNull();
  });

  it.each([
    [
      "\u7533\u8bf7\u4e66.pdf",
      `attachment; filename="___.pdf"; filename*=UTF-8''%E7%94%B3%E8%AF%B7%E4%B9%A6.pdf`,
    ],
    ['a"b.pdf', `attachment; filename="a_b.pdf"; filename*=UTF-8''a%22b.pdf`],
    ["plain.png", `attachment; filename="plain.png"; filename*=UTF-8''plain.png`],
  ])("builds a download disposition for %s", (filename, expected) => {
    expect(attachmentDisposition(filename)).toBe(expected);
  });

  it("reports an upload failure as our own message and logs the provider's", async () => {
    const client = s3ClientFor(SETTINGS);
    const providerError = new Error(
      "NoSuchBucket: pop-engine-documents at project-ref.supabase.co",
    );
    vi.spyOn(client, "send").mockRejectedValue(providerError);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createS3DocumentStorage(client, SETTINGS.bucket);

    await expect(
      storage.put("key.pdf", pdfStream(), "application/pdf", PDF.byteLength),
    ).rejects.toThrow(new DocumentStorageError("document storage is unavailable"));
    expect(logged).toHaveBeenCalledWith("document upload to object storage failed", providerError);
  });

  it("deletes the object at a key, for compensating a failed metadata write", async () => {
    const client = s3ClientFor(SETTINGS);
    const send = vi.spyOn(client, "send").mockResolvedValue(undefined as never);
    const storage = createS3DocumentStorage(client, SETTINGS.bucket);

    await storage.remove("checklist-items/abc/def.pdf");

    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: SETTINGS.bucket,
      Key: "checklist-items/abc/def.pdf",
    });
  });

  it("reports a failed deletion as our own message", async () => {
    const client = s3ClientFor(SETTINGS);
    vi.spyOn(client, "send").mockRejectedValue(new Error("AccessDenied for pop-engine-documents"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createS3DocumentStorage(client, SETTINGS.bucket);

    await expect(storage.remove("key.pdf")).rejects.toThrow(
      new DocumentStorageError("document storage is unavailable"),
    );
    expect(logged).toHaveBeenCalledOnce();
  });

  it("reports a signing failure as our own message", async () => {
    const client = new S3Client({
      region: SETTINGS.region,
      endpoint: SETTINGS.endpoint,
      credentials: () => Promise.reject(new Error("credentials for project-ref are expired")),
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = createS3DocumentStorage(client, SETTINGS.bucket);

    await expect(storage.signedDownloadUrl("key.pdf", 300, "key.pdf")).rejects.toThrow(
      new DocumentStorageError("document storage is unavailable"),
    );
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe("unconfigured document storage", () => {
  it("refuses both operations rather than pretending an upload was stored", async () => {
    const storage = unconfiguredDocumentStorage();
    const notConfigured = new DocumentStorageError("document storage is not configured");

    await expect(
      storage.put("key.pdf", pdfStream(), "application/pdf", PDF.byteLength),
    ).rejects.toThrow(notConfigured);
    await expect(storage.signedDownloadUrl("key.pdf", 300, "key.pdf")).rejects.toThrow(
      notConfigured,
    );
    await expect(storage.remove("key.pdf")).rejects.toThrow(notConfigured);
  });
});
