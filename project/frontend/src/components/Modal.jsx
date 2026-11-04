import { useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ title, onClose, onDeliberateClose, children }) {
  const titleId = useId();
  const modalRef = useRef(null);
  const previousActiveElement = useRef(null);
  // onClose is always a fresh inline arrow from the parent; reading it through
  // a ref (kept current here) lets the mount effect below run only once
  // instead of re-grabbing focus on every parent re-render while open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // Ruling 10: × is a deliberate discard (caller clears the draft first via
  // onDeliberateClose), backdrop/Escape are not — same freshness need as
  // onClose above, so the ref pattern extends to this prop too.
  const onDeliberateCloseRef = useRef(onDeliberateClose);
  useEffect(() => {
    onDeliberateCloseRef.current = onDeliberateClose;
  }, [onDeliberateClose]);

  useEffect(() => {
    previousActiveElement.current = document.activeElement;

    const modalEl = modalRef.current;
    const focusables = modalEl
      ? Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR))
      : [];
    // prefer the first non-close-button control so typing/choosing doesn't require an extra Tab
    const initial = focusables.find((el) => !el.matches(".modal-head button")) || focusables[0];
    initial?.focus();

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const current = modalEl
        ? Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR))
        : [];
      if (current.length === 0) return;

      const first = current[0];
      const last = current[current.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !modalEl.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !modalEl.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement.current?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button onClick={() => (onDeliberateCloseRef.current ?? onCloseRef.current)()} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
