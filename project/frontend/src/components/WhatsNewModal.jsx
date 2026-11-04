import Modal from "./Modal";

// Reused for both the one-time boot popup (viewOnly false, dismiss acks the
// current version) and Settings' always-available re-read (viewOnly true, no
// ack — Modal's own Escape/backdrop/× close all funnel through the same
// onClose since there's only ever one way out of this modal).
export default function WhatsNewModal({ entries, onClose, viewOnly, onAck }) {
  function handleClose() {
    if (!viewOnly) onAck?.();
    onClose();
  }

  return (
    <Modal title="What's new" onClose={handleClose}>
      {entries.length === 0 ? (
        <p>No release notes to show yet.</p>
      ) : (
        entries.map((entry) => (
          <div key={entry.version} className="whats-new-entry">
            <h4>{entry.version} <span className="hint">{entry.date}</span></h4>
            <ul>
              {entry.notes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          </div>
        ))
      )}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={handleClose}>Got it</button>
      </div>
    </Modal>
  );
}
