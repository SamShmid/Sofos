// The note pane's review margin (mock5 `.review-layout` right column) — one
// `.mcard` per pending content-hunk suggestion OR open comment thread on the
// open note, plus the `.review-bar` bulk-action strip NoteView mounts above
// the whole layout.
// Presentational only: NoteView owns the fetch, the highlight/locate state,
// and every handler passed in here (per-edit decisions live at the note, not
// on this card — Samuel's "technically different suggestions" ruling).
//
// P52.1: a resolved (approved/rejected) suggestion is no longer displayed at
// all — the parent's refetch drops it from `suggestions` the moment the
// approve/reject call succeeds, so every card this component ever renders is
// still pending (Samuel: "if its applied dont show that").
//
// P55: the margin goes polymorphic — NoteView now passes a single ordered
// `marginItems` list ({ kind: "suggestion", ...suggestion } or
// { kind: "comment", thread }, §3's char-offset ordering) instead of a bare
// suggestions array, plus the existing suggestion props and a matching set
// of comment props. `commentErrors` is keyed by thread id like `cardErrors`
// is keyed by suggestion id, with one reserved key — "composer" — for the
// create-composer's own 409/error (it has no thread id yet).

import { useState } from "react";
import { canWrite, canSuggest } from "../utils/roles";
import { useConfirm } from "../context/ConfirmContext";
import { refineWords } from "../utils/noteDiff";

function initials(username) {
  return (username || "").slice(0, 2).toUpperCase();
}

function timeOf(doc) {
  return new Date(doc.createdAt).toLocaleDateString();
}

// P54 (logged design call): "Done" is dropped — on a real route, back/
// breadcrumbs already cover leaving the review, so the bar no longer takes
// an onDone prop at all.
export function ReviewBar({ proposerName, pendingCount, busy, error, canAct, onApproveRemaining, onRejectRemaining }) {
  const label = proposerName
    ? `${proposerName}'s edits · ${pendingCount} pending`
    : `${pendingCount} edit${pendingCount === 1 ? "" : "s"} pending`;
  return (
    <div className="review-bar">
      <b>{label}</b>
      <span style={{ flex: 1 }} />
      {error && <span className="approve-error">⚠ {error}</span>}
      {canAct && (
        <>
          <button type="button" className="btn btn-approve" disabled={busy} onClick={onApproveRemaining}>Approve remaining</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRejectRemaining}>Reject remaining</button>
        </>
      )}
    </div>
  );
}

function MarginCard({ suggestion, located, active, error, canApprove, isOwn, onFocus, onApprove, onReject, onRetract, cardRef }) {
  const { old, new: added } = suggestion.payload.contentHunk;
  return (
    <div
      ref={cardRef}
      className={"mcard" + (active ? " active" : "")}
      onClick={() => onFocus(suggestion._id)}
    >
      <div className="mcard-head">
        <span className="avatar">{initials(suggestion.proposedBy?.username)}</span>
        <span className="who-name">{suggestion.proposedBy?.username || "Unknown"}</span>
        <span className="who-time">{timeOf(suggestion)}</span>
        <span className="mcard-kind">suggestion</span>
      </div>
      <div>
        {old && added ? (
          refineWords(old, added).map((seg, i) =>
            seg.type === "same" ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <span key={i} className={seg.type === "del" ? "old" : "new"}>{seg.text}</span>
            )
          )
        ) : old ? (
          <span className="old">{old}</span>
        ) : added ? (
          <span className="new">{added}</span>
        ) : null}
      </div>
      {!located && (
        <p className="shared-meta">The note's text has changed since this was suggested.</p>
      )}
      {error && <p className="approve-error">⚠ {error}</p>}
      <div className="mcard-actions">
        {canApprove && (
          <>
            <button type="button" className="btn btn-approve" onClick={(e) => { e.stopPropagation(); onApprove(suggestion._id); }}>Approve</button>
            <button type="button" className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); onReject(suggestion._id); }}>Reject</button>
          </>
        )}
        {!canApprove && isOwn && (
          <button type="button" className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); onRetract(suggestion._id); }}>Retract</button>
        )}
      </div>
    </div>
  );
}

// EXPORTED — F3's mobile CommentSheet renders the same card for a tapped
// thread, so all the reply/resolve/delete interaction lives here once
// instead of being duplicated between the margin and the sheet.
// Readers: canReply/canResolveThread are both false (roles.js), and a
// reader is never a thread/reply author either — so the ruling ("cards
// fully visible, zero inputs/actions") falls out of the ownership checks
// below without a separate reader-only branch.
export function CommentCard({ thread, active, error, userId, effectiveRole, noteTitle, onFocus, onReply, onResolve, onDeleteComment, onDeleteReply, cardRef }) {
  const confirm = useConfirm();
  const [replyText, setReplyText] = useState("");
  const canReply = canSuggest(effectiveRole);
  const canResolveThread = canWrite(effectiveRole);
  const isRootAuthor = thread.createdBy?._id === userId;
  const replies = thread.replies || [];

  function submitReply() {
    const body = replyText.trim();
    if (!body) return;
    onReply(body);
    setReplyText("");
  }

  async function handleDelete(e) {
    e.stopPropagation();
    const ok = await confirm({
      title: "Delete thread",
      message: `Delete this comment thread on "${noteTitle}"? Replies from everyone are deleted too.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    onDeleteComment();
  }

  return (
    <div ref={cardRef} className={"mcard" + (active ? " active" : "")} onClick={onFocus}>
      <div className="mcard-head">
        <span className="avatar">{initials(thread.createdBy?.username)}</span>
        <span className="who-name">{thread.createdBy?.username || "Unknown"}</span>
        <span className="who-time">{timeOf(thread)}</span>
        <span className="mcard-kind">comment</span>
      </div>
      <div>{thread.body}</div>
      {replies.length > 0 && (
        <div className="thread">
          {replies.map((r) => (
            <div key={r._id}>
              <span className="who-name">{r.author?.username || "Unknown"}</span>{" "}
              <span className="who-time">{timeOf(r)}</span>
              {r.author?._id === userId && (
                <button type="button" className="linklike" onClick={(e) => { e.stopPropagation(); onDeleteReply(r._id); }}>×</button>
              )}
              <div>{r.body}</div>
            </div>
          ))}
        </div>
      )}
      {canReply && (
        <input
          className="reply-input"
          type="text"
          placeholder="Reply…"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitReply(); } }}
        />
      )}
      {error && <p className="approve-error">⚠ {error}</p>}
      <div className="mcard-actions">
        {canResolveThread && (
          <button type="button" className="linklike" onClick={(e) => { e.stopPropagation(); onResolve(); }}>Resolve</button>
        )}
        {isRootAuthor && (
          <button type="button" className="linklike" onClick={handleDelete}>Delete</button>
        )}
      </div>
    </div>
  );
}

// Gold-tinted `.mcard` at the top of the margin (mock6) — its own class
// alongside `.mcard` so F3 can tint it without touching every other card.
function ComposerCard({ error, onSubmit, onCancel }) {
  const [body, setBody] = useState("");
  return (
    <div className="mcard comment-composer">
      <textarea
        placeholder="Add a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        autoFocus
      />
      {error && <p className="approve-error">⚠ {error}</p>}
      <div className="mcard-actions">
        <button type="button" className="btn btn-primary" disabled={!body.trim()} onClick={() => onSubmit(body.trim())}>Comment</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function NoteMargin({
  marginItems = [],
  locatedIds,
  activeId,
  cardErrors,
  approver,
  userId,
  onFocus,
  onApprove,
  onReject,
  onRetract,
  registerCardRef,
  activeCommentId,
  commentErrors = {},
  composer,
  effectiveRole,
  noteTitle,
  onCommentFocus,
  onCreateComment,
  onCancelComposer,
  onReply,
  onResolve,
  onDeleteComment,
  onDeleteReply,
  registerCommentCardRef,
}) {
  return (
    <div className="review-margin">
      {composer && (
        <ComposerCard
          error={commentErrors.composer}
          onSubmit={onCreateComment}
          onCancel={onCancelComposer}
        />
      )}
      {marginItems.map((item) =>
        item.kind === "comment" ? (
          <CommentCard
            key={item.thread._id}
            thread={item.thread}
            active={item.thread._id === activeCommentId}
            error={commentErrors[item.thread._id]}
            userId={userId}
            effectiveRole={effectiveRole}
            noteTitle={noteTitle}
            onFocus={() => onCommentFocus(item.thread._id)}
            onReply={(body) => onReply(item.thread._id, body)}
            onResolve={() => onResolve(item.thread._id)}
            onDeleteComment={() => onDeleteComment(item.thread._id)}
            onDeleteReply={(replyId) => onDeleteReply(item.thread._id, replyId)}
            cardRef={(el) => registerCommentCardRef(item.thread._id, el)}
          />
        ) : (
          <MarginCard
            key={item._id}
            suggestion={item}
            located={locatedIds.has(item._id)}
            active={item._id === activeId}
            error={cardErrors[item._id]}
            canApprove={approver}
            isOwn={item.proposedBy?._id === userId}
            onFocus={onFocus}
            onApprove={onApprove}
            onReject={onReject}
            onRetract={onRetract}
            cardRef={(el) => registerCardRef(item._id, el)}
          />
        )
      )}
    </div>
  );
}
