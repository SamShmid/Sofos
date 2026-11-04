import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import {
  getAttachments,
  uploadFile,
  renameAttachment,
  deleteAttachment,
  downloadAttachment,
} from "../services/attachmentsService";
import { createSuggestion } from "../services/suggestionsService";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString();
}

// Files list for a workspace or project container. Mirrors LinksSection but
// with no drag-reorder (attachments always sort newest-first) and a chunked
// upload flow instead of a create form. canSuggest (pure suggesters) reuses
// the rename/delete affordances as suggestions; upload is now open to canSuggest too —
// the server silos a suggester's upload as a pending attachment.
export default function FilesSection({ container, canWrite, canSuggest }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [files, setFiles] = useState([]);
  const [editingFile, setEditingFile] = useState(null);
  const [uploading, setUploading] = useState(null); // { filename, progress } | null
  const fileInputRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const loadFiles = () =>
    getAttachments(container)
      .then((data) => { setFiles(data); setError(null); setLoaded(true); })
      .catch(() => { setError("Could not load files"); setLoaded(true); });

  useEffect(() => {
    let ignore = false;
    getAttachments(container)
      .then((data) => { if (!ignore) { setFiles(data); setError(null); setLoaded(true); } })
      .catch(() => { if (!ignore) { setError("Could not load files"); setLoaded(true); } });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container.workspace, container.project, container.includeSubprojects]);

  async function handleFileSelected(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;

    setUploading({ filename: file.name, progress: 0 });
    try {
      const result = await uploadFile({
        file,
        container,
        onProgress: (progress) => setUploading({ filename: file.name, progress }),
      });
      await loadFiles();
      if (result?.suggestion) {
        toast.success("Sent for approval — a writer needs to review this file");
      } else if (result?.scanStatus === "pending_scan") {
        toast.success("Uploaded — awaiting virus scan");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(null);
    }
  }

  async function handleDownload(file) {
    try {
      await downloadAttachment(file._id, file.filename);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleRename(data) {
    if (canWrite) {
      await renameAttachment(editingFile._id, data.filename, editingFile.__v);
      setEditingFile(null);
      await loadFiles();
      return;
    }
    await createSuggestion({ resourceType: "Attachment", op: "update", resource: editingFile._id, payload: data });
    toast.success("Suggested — awaiting a writer's approval");
    setEditingFile(null);
  }

  async function handleDelete(file) {
    if (canWrite) {
      const ok = await confirm({
        title: "Move to trash",
        message: `Move "${file.filename}" to trash?`,
        confirmLabel: "Move to trash",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteAttachment(file._id);
        await loadFiles();
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    const ok = await confirm({
      title: "Suggest deletion",
      message: `Suggest deleting "${file.filename}"?`,
      confirmLabel: "Suggest",
      danger: true,
    });
    if (!ok) return;
    try {
      await createSuggestion({ resourceType: "Attachment", op: "delete", resource: file._id });
      toast.success("Suggested — awaiting a writer's approval");
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!canWrite && !canSuggest && !error && files.length === 0) return null;

  return (
    <div>
      <div className="section-label">Files{loaded && !error ? ` · ${files.length}` : ""}</div>
      {error && <p role="alert">{error}</p>}
      {loaded && !error && (
        <>
          <ul className="row-list">
            {files.map((file) => (
              <FileRow
                key={file._id}
                file={file}
                canWrite={canWrite}
                canSuggest={canSuggest}
                onDownload={handleDownload}
                onEdit={setEditingFile}
                onDelete={handleDelete}
              />
            ))}
          </ul>
          {(canWrite || canSuggest) && (
            <>
              <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileSelected} />
              <button className="add-inline" onClick={() => fileInputRef.current?.click()} disabled={!!uploading}>
                {canWrite ? "+ File" : "+ Suggest file"}
              </button>
              {uploading && (
                <div className="upload-progress">
                  <span>{uploading.filename}</span>
                  <div className="upload-progress-track">
                    <div className="upload-progress-fill" style={{ width: `${Math.round(uploading.progress * 100)}%` }} />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {editingFile && (
        <Modal title="Rename file" onClose={() => setEditingFile(null)}>
          <RenameForm initial={editingFile} onSubmit={handleRename} onCancel={() => setEditingFile(null)} />
        </Modal>
      )}
    </div>
  );
}

function FileRow({ file, canWrite, canSuggest, onDownload, onEdit, onDelete }) {
  return (
    <li>
      <span className="glyph">⬒</span>
      <button type="button" className="fname" onClick={() => onDownload(file)} title={file.filename}>
        {file.filename}
      </button>
      <span className="meta">{formatSize(file.size)} · {formatDate(file.createdAt)}</span>
      {file.scanStatus === "pending_scan" && (
        <span className="status-chip file-scan-chip">scanning…</span>
      )}
      {(canWrite || canSuggest) && (
        <>
          <button
            type="button"
            className="goal-edit-btn"
            aria-label={canWrite ? "Rename file" : "Suggest a rename"}
            title={canWrite ? "Rename file" : "Suggest a rename"}
            onClick={() => onEdit(file)}
          >
            ✎
          </button>
          <button
            type="button"
            className="delete-x"
            aria-label={canWrite ? "Delete file" : "Suggest removal"}
            title={canWrite ? "Delete file" : "Suggest removal"}
            onClick={() => onDelete(file)}
          >
            ×
          </button>
        </>
      )}
    </li>
  );
}

function RenameForm({ initial, onSubmit, onCancel }) {
  const [filename, setFilename] = useState(initial.filename);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!filename.trim()) {
      setError("Filename is required");
      return;
    }
    try {
      await onSubmit({ filename: filename.trim() });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <input value={filename} onChange={(e) => setFilename(e.target.value)} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">Save</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
