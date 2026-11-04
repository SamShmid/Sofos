import { useEffect, useRef } from "react";
import { useTagColors } from "../context/TagColorsContext";
import { useToast } from "../context/ToastContext";
import { setTagColor } from "../services/tagsService";
import { resolveTagColor } from "../utils/tags";

// Names transcribed from docs/design/mock2-dark.html's tag-swatch legend
// (c0-c7, the same hues already in index.css) plus PHASE_SPEC's c8-c15 table.
const HUE_NAMES = [
  "teal", "green", "gold", "coral", "pink", "purple", "indigo", "slate-cyan",
  "ocean", "bronze", "graphite", "magenta", "lime", "cyan", "steel", "periwinkle",
];

// Anchored inline popover for one tag chip (parent chip is the positioning
// context — see .tag-chip's position:relative in index.css). Esc or a click
// outside closes it; a swatch pick is optimistic (setLocal, then PUT),
// reverted with a toast on failure.
export default function TagColorPopover({ tag, tenantId, onClose }) {
  const { maps, setLocal } = useTagColors();
  const toast = useToast();
  const popoverRef = useRef(null);
  const current = resolveTagColor(tag, tenantId, maps);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    function handlePointerDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose]);

  async function pick(color) {
    const previous = maps?.[tenantId]?.[tag] ?? null;
    setLocal(tenantId, tag, color);
    onClose();
    try {
      await setTagColor(tag, color);
    } catch (err) {
      setLocal(tenantId, tag, previous);
      toast.error(err.message);
    }
  }

  return (
    <div className="tag-color-popover" role="group" aria-label={`Set color for ${tag}`} ref={popoverRef}>
      <div className="tag-color-swatches">
        {HUE_NAMES.map((name, idx) => (
          <button
            key={name}
            type="button"
            className={`tag-color-swatch c${idx}${idx === current ? " selected" : ""}`}
            aria-label={`Set ${tag} to ${name}`}
            onClick={() => pick(idx)}
          />
        ))}
      </div>
      <button type="button" className="tag-color-auto" onClick={() => pick(null)}>Auto</button>
    </div>
  );
}
