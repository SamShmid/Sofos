// Mobile-only thread view (P55): a tap on a `.hl-comment` gold span opens
// this instead of scrolling to the margin, which doesn't exist at mobile
// widths (NoteView owns that `matchMedia` gate — see RoadmapTrack.jsx's
// listener idiom). Wraps F1's CommentCard unchanged, staged inside a fixed
// bottom sheet instead of the margin column — same markup, same handlers.
import { useEffect, useRef } from "react";
import { CommentCard } from "./NoteMargin";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CommentSheet({
  thread,
  userId,
  effectiveRole,
  noteTitle,
  error,
  onReply,
  onResolve,
  onDeleteComment,
  onDeleteReply,
  onClose,
}) {
  const sheetRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Modal.jsx's focus-return pattern: capture what had focus, move focus
  // into the sheet on mount, restore it on unmount.
  useEffect(() => {
    previousActiveElement.current = document.activeElement;
    const focusable = sheetRef.current?.querySelector(FOCUSABLE_SELECTOR);
    focusable?.focus();
    return () => previousActiveElement.current?.focus?.();
  }, []);

  function handleKeyDown(e) {
    if (e.key !== "Escape") return;
    // Dropdown-inside-Modal precedent: stop here so a wrapping Escape
    // listener (there isn't one today, but the sheet shouldn't assume) only
    // ever sees the sheet close, never a second, unrelated close.
    e.stopPropagation();
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        className="comment-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Comment thread"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="sheet-head">
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {/* CommentCard's handlers are thread-relative (onReply(body),
            onDeleteReply(replyId)); NoteView's are thread-keyed, exactly as
            NoteMargin passes them per card — so the sheet binds its one
            thread's id the same way the margin does. */}
        <CommentCard
          thread={thread}
          error={error}
          userId={userId}
          effectiveRole={effectiveRole}
          noteTitle={noteTitle}
          onReply={(body) => onReply(thread._id, body)}
          onResolve={() => onResolve(thread._id)}
          onDeleteComment={() => onDeleteComment(thread._id)}
          onDeleteReply={(replyId) => onDeleteReply(thread._id, replyId)}
        />
      </div>
    </div>
  );
}
