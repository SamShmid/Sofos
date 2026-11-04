import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import MeContext from "../context/MeContext";
import { getMe, ackMe } from "../services/meService";
import { getStoredPref, applyPref } from "../theme";
import Header from "./Header";
import Footer from "./Footer";
import Sidebar from "./Sidebar";
import WhatsNewModal from "./WhatsNewModal";
import Tour from "./Tour";
import QuickSwitcher from "./QuickSwitcher";

// Settings' "Replay tour" writes this before navigating to `/`; read-and-cleared
// below (on mount, and again on every route change since Layout doesn't remount
// for an in-app nav) so the tour relaunches once without waiting on tourSeen.
const REPLAY_TOUR_KEY = "sofos.replayTour";

export default function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  // getMe's payload, kept whole so the ack handlers can read version.current
  // without a second fetch; null until the boot fetch resolves.
  const [me, setMe] = useState(null);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [showTour, setShowTour] = useState(false);
  // First-boot tour is due (tourSeen was false, no replay) but they weren't on
  // Overview when it resolved — every step is anchored there now (P32), so the
  // route-change effect below launches it once they actually land on `/`.
  const [needsTour, setNeedsTour] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Route changes close the drawer — covers sidebar link clicks and any other
  // navigation (redirects, browser back/forward).
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => { setSwitcherOpen(false); }, [location.pathname]);

  // Global Cmd-K/Ctrl-K: registered/cleaned up once. A second press while
  // open always toggles it closed. Opening is suppressed when another modal
  // is already on screen (any `.modal-backdrop`/`.tour-overlay` currently
  // rendered, wherever in the tree it lives — cheaper and more robust than
  // threading every page's modal state up through Layout) or when focus is
  // sitting in a native input/textarea elsewhere in the app (don't hijack
  // mid-typing). Checked only on the opening transition, never on close.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setSwitcherOpen((prev) => {
        if (prev) return false;
        if (document.querySelector(".modal-backdrop, .tour-overlay")) return prev;
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return prev;
        return true;
      });
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // One getMe() per mount (Layout only ever mounts authed, under RequireAuth) —
  // drives Tour-then-What's-new precedence (P45), never both in the same boot:
  // an unseen tour always goes first; a pending What's-new waits for finishTour
  // to chain it open (or, when the tour is already seen/not due, shows immediately).
  useEffect(() => {
    if (!user) return;
    const replay = sessionStorage.getItem(REPLAY_TOUR_KEY) === "true";
    if (replay) sessionStorage.removeItem(REPLAY_TOUR_KEY);

    getMe()
      .then((data) => {
        setMe(data);
        // Server wins over the device mirror (contract 3) — only touches the
        // DOM/localStorage when they actually diverge.
        if (data.themePref !== getStoredPref()) applyPref(data.themePref);

        const tourDue = !user.isAgent && (replay || !data.version.tourSeen);
        if (tourDue) {
          // Anchored-on-Overview (P32): launch immediately if that's where
          // they already are, otherwise defer to the route-change effect.
          // Any pending What's-new waits — finishTour chains it open below.
          if (location.pathname === "/") setShowTour(true);
          else setNeedsTour(true);
        } else if (data.whatsNew.length > 0) {
          setShowWhatsNew(true);
        }
      })
      .catch(() => {}); // best-effort: boot flow just shows nothing, app stays usable
    // Deliberately []: fire exactly once per mount, not on every user change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Settings' "Replay tour" sets the flag then navigates to `/` — but Layout
  // itself never remounts for an in-app route change, so the mount-once effect
  // above never sees it. Re-check on every route change too; still guards on
  // !showWhatsNew so a What's-new already on screen (from a prior finishTour
  // chain, or shown immediately because no tour was due) isn't stepped on.
  // Also catches the first-boot case above when they land on `/` later.
  useEffect(() => {
    if (!user) return;
    const replay = sessionStorage.getItem(REPLAY_TOUR_KEY) === "true";
    if (replay) {
      sessionStorage.removeItem(REPLAY_TOUR_KEY);
      if (!user.isAgent && !showWhatsNew) setShowTour(true);
      return;
    }
    if (needsTour && location.pathname === "/" && !showWhatsNew) {
      setNeedsTour(false);
      setShowTour(true);
    }
    // Deliberately keyed only on the route: showWhatsNew/user/needsTour are
    // read at the moment the route changes, not deferred if they change after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function ackWhatsNew() {
    ackMe({ lastSeenVersion: me.version.current }).catch(() => {});
  }

  function finishTour() {
    setShowTour(false);
    ackMe({ tourSeen: true }).catch(() => {});
    // Chain What's-new open once the tour is out of the way (P45 tour-first).
    if (me && me.whatsNew.length > 0) setShowWhatsNew(true);
  }

  return (
    <MeContext.Provider value={{ me, setMe }}>
      <div className="app">
        <Header onMenuToggle={() => setOpen((o) => !o)} open={open} onSearchClick={() => setSwitcherOpen(true)} />
        <div className="app-body">
          <Sidebar open={open} onNavigate={() => setOpen(false)} />
          {open && (
            <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          )}
          <main className="main-content">
            <Outlet />
          </main>
        </div>
        <Footer />
        {showWhatsNew && me && (
          <WhatsNewModal entries={me.whatsNew} onAck={ackWhatsNew} onClose={() => setShowWhatsNew(false)} />
        )}
        {showTour && <Tour onFinish={finishTour} />}
        {switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} />}
      </div>
    </MeContext.Provider>
  );
}
