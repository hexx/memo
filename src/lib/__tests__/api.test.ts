import { describe, it, expect, beforeEach, vi } from "vitest";

// We test the API client functions; mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Dynamic import so our mock is in effect
async function getApiModule() {
  return import("../../lib/api");
}

function mockResponse(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

describe("api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("getMemos", () => {
    it("fetches memos with no params", async () => {
      const { getMemos } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(200, [{ id: "1", title: "Test" }]));

      const result = await getMemos();
      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalled();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/memos");
    });

    it("sends query params when provided", async () => {
      const { getMemos } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(200, []));

      await getMemos({ q: "search", label: "label1" });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("q=search");
      expect(url).toContain("label=label1");
    });

    it("sends archived param", async () => {
      const { getMemos } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(200, []));

      await getMemos({ archived: true });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("archived=1");
    });
  });

  describe("createMemo", () => {
    it("sends POST with correct body", async () => {
      const { createMemo } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(201, { id: "new" }));

      const result = await createMemo({ title: "New", body: "Body" });
      expect(result.id).toBe("new");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/memos",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ title: "New", body: "Body" }),
        })
      );
    });
  });

  describe("updateMemo", () => {
    it("sends PUT with correct path and body", async () => {
      const { updateMemo } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));

      await updateMemo("m123", { title: "Updated", body: "New body" });
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/memos/m123",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ title: "Updated", body: "New body" }),
        })
      );
    });
  });

  describe("deleteMemo", () => {
    it("sends DELETE", async () => {
      const { deleteMemo } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));

      await deleteMemo("m123");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/memos/m123",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("togglePin", () => {
    it("sends PATCH", async () => {
      const { togglePin } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(200, { isPinned: true }));

      const result = await togglePin("m123");
      expect(result.isPinned).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/memos/m123/pin",
        expect.objectContaining({ method: "PATCH" })
      );
    });
  });

  describe("error handling", () => {
    it("throws on non-ok response", async () => {
      const { getMemos } = await getApiModule();
      mockFetch.mockResolvedValueOnce(mockResponse(500, { error: "Server error" }));

      await expect(getMemos()).rejects.toThrow("Server error");
    });

    it("throws on network error", async () => {
      const { getMemos } = await getApiModule();
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(getMemos()).rejects.toThrow("Network error");
    });

    it("throws generic error when response is not JSON", async () => {
      const { getMemos } = await getApiModule();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => {
          throw new Error("Not JSON");
        },
      });

      // When json() fails, the catch returns fallback message
      await expect(getMemos()).rejects.toThrow("Request failed");
    });
  });

  describe("getExportUrl", () => {
    it("returns correct export URL", async () => {
      const { getExportUrl } = await getApiModule();
      expect(getExportUrl("abc")).toBe("/api/memos/abc/export");
    });
  });
});
