// Pure keyboard-nav helpers for Dropdown.jsx — split out so the clamped
// index math and type-to-find buffer logic are node-testable without a DOM.

export const TYPEAHEAD_RESET_MS = 700;

export function firstEnabledIndex(options) {
  for (let i = 0; i < options.length; i++) {
    if (!options[i].disabled) return i;
  }
  return -1;
}

export function lastEnabledIndex(options) {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i].disabled) return i;
  }
  return -1;
}

// Clamped (not wrapping) move — QuickSwitcher's Math.min/max convention —
// steps from `current` in `direction` (+1/-1), skipping disabled options,
// and stops at the boundary if nothing enabled lies further that way.
export function moveActive(options, current, direction) {
  if (options.length === 0) return -1;
  for (let i = current + direction; i >= 0 && i < options.length; i += direction) {
    if (!options[i].disabled) return i;
  }
  // Nothing further in that direction: if current itself isn't a valid
  // resting place (unset or disabled), fall back to the nearest end;
  // otherwise stay put (the clamp).
  if (current < 0 || options[current]?.disabled) {
    return direction > 0 ? firstEnabledIndex(options) : lastEnabledIndex(options);
  }
  return current;
}

// Accumulates typed characters into a buffer, resetting it when the pause
// since the last keystroke exceeds TYPEAHEAD_RESET_MS.
export function nextTypeAheadBuffer(prevBuffer, prevTime, char, now) {
  if (prevBuffer && now - prevTime <= TYPEAHEAD_RESET_MS) return prevBuffer + char;
  return char;
}

// First enabled option whose label starts with the buffer, case-insensitive.
export function matchTypeAhead(options, buffer) {
  if (!buffer) return -1;
  const needle = buffer.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    if (options[i].disabled) continue;
    if (String(options[i].label).toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}
