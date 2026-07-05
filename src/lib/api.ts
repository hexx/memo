const API_BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface Memo {
  id: string;
  title: string;
  body: string;
  isPinned: number;
  isArchived: number;
  createdAt: string;
  updatedAt: string;
  labels: { id: string; name: string }[];
}

export interface Label {
  id: string;
  name: string;
}

// Memos
export const getMemos = (params?: {
  q?: string;
  label?: string;
  archived?: boolean;
}) => {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.label) sp.set("label", params.label);
  if (params?.archived) sp.set("archived", "1");
  const qs = sp.toString();
  return request<Memo[]>(`/memos${qs ? `?${qs}` : ""}`);
};

export const getMemo = (id: string) => request<Memo>(`/memos/${id}`);

export const createMemo = (data: {
  title: string;
  body: string;
  labelIds?: string[];
}) =>
  request<{ id: string }>("/memos", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateMemo = (
  id: string,
  data: { title: string; body: string; labelIds?: string[] }
) =>
  request<{ ok: boolean }>(`/memos/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteMemo = (id: string) =>
  request<{ ok: boolean }>(`/memos/${id}`, { method: "DELETE" });

export const togglePin = (id: string) =>
  request<{ isPinned: boolean }>(`/memos/${id}/pin`, { method: "PATCH" });

export const toggleArchive = (id: string) =>
  request<{ isArchived: boolean }>(`/memos/${id}/archive`, { method: "PATCH" });

// Labels
export const getLabels = () => request<Label[]>("/labels");

export const createLabel = (name: string) =>
  request<Label>("/labels", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const deleteLabel = (id: string) =>
  request<{ ok: boolean }>(`/labels/${id}`, { method: "DELETE" });

// Import / Export
export const importOrgText = (text: string) =>
  request<{ id: string; title: string; labelCount: number }>("/import", {
    method: "POST",
    body: JSON.stringify({ text }),
  });

export const importOrgFile = async (file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/import`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Import failed" }));
    throw new Error(err.error || "Import failed");
  }
  return res.json() as Promise<{
    id: string;
    title: string;
    labelCount: number;
  }>;
};

export const getExportUrl = (id: string) =>
  `${API_BASE}/memos/${id}/export`;
