import { useEffect, useState } from "react";

// Plain-language, 2-3 sentences each. Three steps (P32 — down from five),
// all anchored on something actually mounted: the first two live on Overview
// (HomePage's `data-tour="overview-workspaces"` / `"home-workspace"`), the
// third on Sidebar's always-mounted Trash link (`data-tour="trash"`) — Layout
// only auto-launches this on `/`, so the anchors are guaranteed present.
// The other former topics (boards, roadmap, suggestions, sharing) are now
// FirstVisitTip cards on their own surfaces instead of being narrated here
// unanchored.
// The card itself is never anchored (P47 — a long sidebar could push it below
// the viewport with no way out); `corner` just steers it clear of whatever
// this step highlights. All three current targets lean left, so the default
// bottom-right suits them all, but the field stays on every entry for
// whichever future step lands on the right half of the screen.
const STEPS = [
  {
    dataTour: "overview-workspaces",
    corner: "bottom-right",
    title: "Your workspaces",
    body: [
      "Overview is your landing page — you can always get back here from the sidebar.",
      "Every workspace you own, or that's shared with you, shows up in this list.",
    ],
  },
  {
    dataTour: "home-workspace",
    corner: "bottom-right",
    title: "Home, pinned for you",
    body: [
      "This is Home — a workspace that's always here, ready for anything that doesn't need a place of its own yet.",
      "It's yours from the moment you sign up, and it can't be deleted.",
    ],
  },
  {
    dataTour: "trash",
    corner: "bottom-right",
    title: "Nothing's gone for good",
    body: [
      "Delete a workspace or project and it lands in Trash first, not gone.",
      "You can recover it from here anytime before it's cleared out for good.",
    ],
  },
];

// A target that's technically in the DOM but translated off-canvas (the
// mobile sidebar drawer, closed) reads as "not really there" — treat it as
// absent instead of highlighting empty space. The card no longer depends on
// this for its own position (P47 — it's always a fixed corner card), only
// for whether to draw the highlight outline.
function anchorRect(key) {
  if (!key) return null;
  const el = document.querySelector(`[data-tour="${key}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.right <= 0 || rect.left >= window.innerWidth) return null;
  return rect;
}

export default function Tour({ onFinish }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer;
    // The step-1/2 anchors live on Overview, which paints a "Loading…"
    // placeholder while its workspace fetch resolves — so on first-boot the
    // tour can outrun them. Re-measure briefly until the anchor mounts, then
    // stop; a genuinely-absent anchor (mobile drawer closed) simply runs the
    // attempts out and the card shows without a highlight (P47 — never
    // blocks on a missing anchor).
    function measure() {
      if (cancelled) return;
      const r = anchorRect(current.dataTour);
      setRect(r);
      if (!r && current.dataTour && attempts < 20) {
        attempts += 1;
        timer = setTimeout(measure, 100);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [step, current.dataTour]);

  // Escape always exits, same as Skip — with the card now always reachable
  // in a fixed corner this isn't an escape-hatch-of-last-resort, just the
  // keyboard behavior any overlay should have.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") onFinish();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFinish]);

  function next() {
    if (isLast) onFinish();
    else setStep((s) => s + 1);
  }

  return (
    <div className="tour-overlay">
      {rect && (
        <div
          className="tour-highlight"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div
        className={`tour-card tour-card--${current.corner === "bottom-left" ? "bl" : "br"}`}
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
      >
        <div className="tour-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`tour-dot${i === step ? " active" : ""}`} />
          ))}
        </div>
        <h3>{current.title}</h3>
        {current.body.map((sentence, i) => <p key={i}>{sentence}</p>)}
        <div className="tour-actions">
          <button className="btn btn-ghost" onClick={onFinish}>Skip</button>
          <button className="btn btn-primary" onClick={next}>{isLast ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
