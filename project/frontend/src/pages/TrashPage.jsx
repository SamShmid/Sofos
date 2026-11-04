import { useEffect, useState } from "react";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { getTrash, restoreFromTrash, hardDelete } from "../services/trashService";

export default function TrashPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  function load() {
    setStatus("loading");
    getTrash()
      .then((data) => { setItems(data); setStatus("ready"); })
      .catch((err) => { setError(err.message); setStatus("error"); });
  }
  useEffect(() => { load(); }, []);

  async function handleRestore(item) {
    try {
      await restoreFromTrash(item.resourceType, item.doc._id);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete(item) {
    const name = item.doc.name || item.doc.title || item.doc.filename;
    const ok = await confirm({
      title: "Delete forever",
      message: `Permanently delete "${name}"? This cannot be undone and also erases its history.`,
      confirmLabel: "Delete forever",
      danger: true,
    });
    if (!ok) return;
    try {
      await hardDelete(item.resourceType, item.doc._id);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <section>
      <h2>Trash</h2>

      {status === "loading" && <p className="loading">Loading…</p>}
      {status === "error" && <p role="alert">{error || "Could not load trash."}</p>}

      {status === "ready" && items.length === 0 && (
        <div className="empty">
          <span className="glyph">◎</span>
          <p>Trash is empty.</p>
        </div>
      )}

      {status === "ready" && items.length > 0 && (
        <ul className="member-list">
          {items.map((item) => (
            <li key={`${item.resourceType}-${item.doc._id}`} className="member-row">
              <span>
                <strong>{item.doc.name || item.doc.title || item.doc.filename}</strong>
                {item.doc.scanStatus === "failed" && (
                  <span className="status-chip scan-failed">⚠ couldn't be scanned — restore to retry</span>
                )}
                {item.doc.scanStatus === "infected" && (
                  <span className="status-chip scan-infected">⚠ infected — restore blocked</span>
                )}
                <br />
                <span className="shared-meta">
                  {item.resourceType} · deleted {new Date(item.deletedAt).toLocaleString()}
                </span>
              </span>
              <span className="member-actions">
                <button className="btn btn-ghost" onClick={() => handleRestore(item)}>Restore</button>
                <button className="btn btn-danger" onClick={() => handleDelete(item)}>Delete forever</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
