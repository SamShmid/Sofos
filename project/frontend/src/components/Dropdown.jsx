import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  firstEnabledIndex,
  lastEnabledIndex,
  matchTypeAhead,
  moveActive,
  nextTypeAheadBuffer,
} from "../utils/dropdownNav";

// Generic replacement for every native select element (Phase 53, Samuel's ruling —
// "bothers me", phones included). Two modes:
//   value mode:  <Dropdown value onChange={(v) => {}} options .../>
//                "" is a legal, selectable value (e.g. TaskForm priority None).
//   action mode: <Dropdown action onSelect={(v) => {}} options .../>
//                never holds a value — after onSelect the trigger snaps back
//                to `placeholder` (replaces the old uncontrolled
//                e.target.value = "" reset idiom GoalNode used to need).
//
// The panel is a DOM CHILD of this component (no portal) so Modal's focus
// trap `contains()` check keeps working, but it's `position: fixed`,
// anchored from the trigger's getBoundingClientRect at open time — that's
// what lets it escape the roadmap canvas's `overflow: hidden`. Reposition on
// scroll/resize is deliberately not attempted (menu closes instead — simple,
// native-like); a layout effect flips it above the trigger and clamps it
// horizontally before first paint if it would otherwise overflow the
// viewport, so there's no visible jump.
//
// Focus never leaves the trigger button — options are role="option" tracked
// via aria-activedescendant, not roving tabindex, so Modal's Tab-wrap logic
// is untouched. Escape is handled on the trigger's own onKeyDown (a React
// synthetic handler) and calls stopPropagation so it never reaches Modal's
// document-level Escape listener — a Dropdown inside a Modal must close only
// itself, not the Modal.
export default function Dropdown({
  value,
  onChange,
  action = false,
  onSelect,
  options,
  ariaLabel,
  labelledBy,
  placeholder = "",
  disabled = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [anchor, setAnchor] = useState(null); // trigger rect captured at open
  const [pos, setPos] = useState(null); // { left, top?, bottom?, flip }

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const typeAheadRef = useRef({ buffer: "", lastTime: 0 });
  const listboxId = useId();

  const selectedIndex = action ? -1 : options.findIndex((o) => o.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const triggerLabel = action ? placeholder : (selectedOption ? selectedOption.label : placeholder);

  function openMenu() {
    if (disabled) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAnchor(rect);
    setPos({ left: rect.left, top: rect.bottom + 4, flip: false });
    const startIndex =
      !action && selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : firstEnabledIndex(options);
    setActiveIndex(startIndex);
    setOpen(true);
  }

  function closeMenu({ refocus = false } = {}) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function toggle() {
    if (open) closeMenu({ refocus: true });
    else openMenu();
  }

  function commit(idx) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    if (action) onSelect(opt.value);
    else onChange(opt.value);
    closeMenu({ refocus: true });
  }

  // Flip above + horizontal clamp, computed after the menu has rendered (and
  // therefore has a real size) but before the browser paints.
  useLayoutEffect(() => {
    if (!open || !anchor || !menuRef.current) return;
    const menuEl = menuRef.current;
    const menuHeight = menuEl.offsetHeight;
    const menuWidth = menuEl.offsetWidth;
    const margin = 8;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const spaceAbove = anchor.top;
    const flip = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const maxLeft = window.innerWidth - menuWidth - margin;
    const left = Math.max(margin, Math.min(anchor.left, maxLeft));
    setPos(
      flip
        ? { left, bottom: window.innerHeight - anchor.top + 4, flip: true }
        : { left, top: anchor.bottom + 4, flip: false }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchor]);

  // Close on window scroll/resize — the menu's own internal scroll is
  // excluded (no reposition attempted, just a clean close).
  useEffect(() => {
    if (!open) return;
    function handleReposition(e) {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      closeMenu();
    }
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mousedown-outside close (TagColorPopover pattern).
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) closeMenu();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleTriggerKeyDown(e) {
    if (disabled) return;
    const key = e.key;

    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    if (key === "Escape") {
      // Menu-only close — must not let a wrapping Modal's Escape handler see this.
      e.preventDefault();
      e.stopPropagation();
      closeMenu({ refocus: true });
      return;
    }
    if (key === "Tab") {
      closeMenu();
      return;
    }
    if (key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((idx) => moveActive(options, idx, 1));
      return;
    }
    if (key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((idx) => moveActive(options, idx, -1));
      return;
    }
    if (key === "Home") {
      e.preventDefault();
      setActiveIndex(firstEnabledIndex(options));
      return;
    }
    if (key === "End") {
      e.preventDefault();
      setActiveIndex(lastEnabledIndex(options));
      return;
    }
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      commit(activeIndex);
      return;
    }
    if (key.length === 1) {
      const now = Date.now();
      const state = typeAheadRef.current;
      const buffer = nextTypeAheadBuffer(state.buffer, state.lastTime, key, now);
      typeAheadRef.current = { buffer, lastTime: now };
      const match = matchTypeAhead(options, buffer);
      if (match >= 0) setActiveIndex(match);
    }
  }

  const menuStyle = pos
    ? {
        position: "fixed",
        left: pos.left,
        ...(pos.flip ? { bottom: pos.bottom } : { top: pos.top }),
        minWidth: anchor?.width,
      }
    : undefined;

  return (
    <div ref={rootRef} className={"dropdown" + (className ? " " + className : "")}>
      <button
        type="button"
        ref={triggerRef}
        className="dropdown-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="dropdown-label">{triggerLabel || placeholder}</span>
        <span className="chevron" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul
          ref={menuRef}
          className="dropdown-menu"
          role="listbox"
          id={listboxId}
          style={menuStyle}
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((opt, idx) => {
            const isSelected = !action && opt.value === value;
            const isActive = idx === activeIndex;
            return (
              <li
                key={opt.value}
                id={`${listboxId}-opt-${idx}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
                className={
                  "dropdown-opt" +
                  (isActive ? " active" : "") +
                  (isSelected ? " selected" : "") +
                  (opt.disabled ? " disabled" : "")
                }
                onMouseEnter={() => !opt.disabled && setActiveIndex(idx)}
                onClick={(e) => {
                  // At the labelledBy sites the whole control sits inside a
                  // <label>, and an option isn't interactive content — so an
                  // un-cancelled click here gets forwarded by the label to the
                  // trigger, which would reopen the menu we just closed.
                  e.preventDefault();
                  commit(idx);
                }}
              >
                <span className="dropdown-opt-label">{opt.label}</span>
                {isSelected && <span className="dropdown-check" aria-hidden="true">✓</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
