import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Modal from "../components/Modal";

const ConfirmContext = createContext(null);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const cancelBtnRef = useRef(null);

  // One dialog at a time: a new confirm() replaces whatever is pending.
  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest(opts);
    });
  }, []);

  function settle(result) {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setRequest(null);
  }

  useEffect(() => {
    if (!request) return;
    // Deferred so it wins over Modal's own on-mount focus handling.
    const id = setTimeout(() => {
      (request.danger ? cancelBtnRef.current : confirmBtnRef.current)?.focus();
    }, 0);
    return () => clearTimeout(id);
  }, [request]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal title={request.title} onClose={() => settle(false)}>
          <p className="confirm-message">{request.message}</p>
          <div className="confirm-actions">
            <button ref={cancelBtnRef} className="btn btn-ghost" onClick={() => settle(false)}>
              {request.cancelLabel || "Cancel"}
            </button>
            <button
              ref={confirmBtnRef}
              className={`btn ${request.danger ? "btn-danger" : "btn-primary"}`}
              onClick={() => settle(true)}
            >
              {request.confirmLabel || "Confirm"}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
