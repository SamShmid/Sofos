import { useEffect, useState } from "react";
import Modal from "./Modal";
import { getRevisions, restoreRevision } from "../services/revisionsService";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";

export default function HistoryModal({ resourceType, resourceId, canWrite, onRestored, onClose }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [revisions, setRevisions] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let ignore = false;
    setStatus("loading");
    getRevisions(resourceType, resourceId)
      .then((r) => { if (!ignore) { setRevisions(r); setStatus("ready"); } })
      .catch(() => { if (!ignore) setStatus("error"); });
    return () => { ignore = true; };
  }, [resourceType, resourceId]);

  async function handleRestore(revisionId) {
    const ok = await confirm({
      title: "Restore version",
      message: "Restore this version? Current content becomes a new history entry.",
      confirmLabel: "Restore",
      danger: false,
    });
    if (!ok) return;
    try {
      await restoreRevision(revisionId);
      onRestored();
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal title="History" onClose={onClose}>
      {status === "loading" && <p>Loading…</p>}
      {status === "error" && <p role="alert">Could not load history.</p>}
      {status === "ready" && revisions.length === 0 && <p>No history yet.</p>}
      {status === "ready" && revisions.length > 0 && (
        <ul className="member-list">
          {revisions.map((rev) => (
            <li key={rev._id} className="member-row history-row">
              <span>
                <strong>{rev.operation}</strong> by {rev.editedBy?.username || "Deleted user"}
                <br />
                <span className="shared-meta">{new Date(rev.createdAt).toLocaleString()}</span>
              </span>
              {canWrite && (rev.operation === "update" || rev.operation === "delete") && (
                <span className="member-actions">
                  <button className="btn btn-ghost" onClick={() => handleRestore(rev._id)}>Restore this version</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
