import { useMe } from "../context/MeContext";
import { ackMe } from "../services/meService";

// One-time dismissible card, gated per-account server-side (tipsSeen, P32) —
// not localStorage, so it stays dismissed across devices/logins. Renders
// nothing until `me` has loaded, or once tipId is already in tipsSeen.
export default function FirstVisitTip({ tipId, children }) {
  const { me, setMe } = useMe();
  if (!me || (me.tipsSeen || []).includes(tipId)) return null;

  function dismiss() {
    setMe((prev) => ({ ...prev, tipsSeen: [...(prev.tipsSeen || []), tipId] }));
    ackMe({ tipSeen: tipId }).catch(() => {});
  }

  return (
    <div className="first-tip">
      <p>{children}</p>
      <button type="button" className="btn btn-ghost" onClick={dismiss}>Got it</button>
    </div>
  );
}
