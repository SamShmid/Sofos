import { request, BASE_URL, throwIfError } from "./api";

export const getAttachments = ({ workspace, project, includeSubprojects = false }) =>
  request(`/attachments?${workspace ? `workspace=${workspace}` : `project=${project}`}${includeSubprojects ? "&includeSubprojects=1" : ""}`).then((r) => r.data);

// Chunked upload: start a session, PUT chunks in order over raw fetch (not
// the JSON `request` wrapper), then finalize. Aborts the session best-effort
// if a chunk fails so the server doesn't hold an orphaned tmp file forever.
export async function uploadFile({ file, container, onProgress }) {
  const { uploadId, chunkSize } = await request("/uploads", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, ...container }),
  }).then((r) => r.data);

  const token = localStorage.getItem("token");
  let index = 0;
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, file.size);
    const res = await fetch(`${BASE_URL}/uploads/${uploadId}/chunks/${index}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: file.slice(start, end),
    });

    if (!res.ok) {
      await request(`/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
      await throwIfError(res);
    }

    onProgress?.(end / file.size);
    index += 1;
  }

  return request(`/uploads/${uploadId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ size: file.size }),
  }).then((r) => r.data);
}

export const renameAttachment = (id, filename, ifVersion) =>
  request(`/attachments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(ifVersion !== undefined ? { filename, ifVersion } : { filename }),
  }).then((r) => r.data);

export const deleteAttachment = (id) =>
  request(`/attachments/${id}`, { method: "DELETE" });

// Plain `<a href>` can't carry the Bearer header, so fetch the bytes
// ourselves and trigger the download via an object URL.
export async function downloadAttachment(id, filename) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE_URL}/attachments/${id}/download`, {
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
  });

  await throwIfError(res);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
