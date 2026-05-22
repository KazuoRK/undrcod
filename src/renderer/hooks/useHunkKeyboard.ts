import { useEffect, type RefObject } from 'react';

/**
 * Global keyboard hook for navigating diff hunks (Antigravity-style).
 *
 * Attaches a `keydown` listener on `window` and forwards specific shortcuts
 * to a DiffViewer ref that implements {@link HunkNavigable}.
 *
 * Bindings:
 *  - `Alt+J`                  → `focusNextHunk()`
 *  - `Alt+K`                  → `focusPrevHunk()`
 *  - `Alt+Enter`              → `acceptCurrent()`
 *  - `Alt+Shift+Enter`        → `acceptAll()` (fallback: `acceptCurrent`)
 *  - `Alt+Shift+Backspace`    → `rejectCurrent()`
 *
 * The handler is a no-op when:
 *  - `enabled === false`
 *  - `diffViewerRef.current` is null
 *  - the active event target is an editable element (`input`, `textarea`,
 *    `contenteditable`) — só the shortcuts never steal keystrokes from text
 *    composers
 *  - an IME composition session is in progress (`event.isComposing` or
 *    `keyCode === 229`)
 *
 * @example
 * ```tsx
 * const diffRef = useRef<HunkNavigable | null>(null);
 * useHunkKeyboard({ diffViewerRef: diffRef, enabled: activeTab === 'diff' });
 * return <DiffViewer ref={diffRef} ... />;
 * ```
 */

export interface HunkNavigable {
  focusNextHunk(): void;
  focusPrevHunk(): void;
  acceptCurrent(): void;
  rejectCurrent(): void;
  /** Optional — invoked on Alt+Shift+Enter (accept-all). */
  acceptAll?(): void;
}

export interface UseHunkKeyboardOptions {
  /** ref to the active DiffViewer; if null, hook is no-op */
  diffViewerRef: RefObject<HunkNavigable | null>;
  /** when true, hook listens; when false, it does nothing */
  enabled?: boolean;
}

/** Returns true if the event originated inside an editable element. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/** Safely invoke a ref method; never let a bad impl crash the renderer. */
function safeCall(label: string, fn: (() => void) | undefined): void {
  if (typeof fn !== 'function') {
    console.warn(`[useHunkKeyboard] ${label} is not a function on diffViewerRef`);
    return;
  }
  try {
    fn();
  } catch (err) {
    console.warn(`[useHunkKeyboard] ${label} threw:`, err);
  }
}

export function useHunkKeyboard(opts: UseHunkKeyboardOptions): void {
  const { diffViewerRef, enabled = true } = opts;

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      // No-op gates — still attached só parent can toggle without remount.
      if (!enabled) return;
      const target = diffViewerRef.current;
      if (!target) return;

      // Ignore while typing in editable surfaces.
      if (isEditableTarget(event.target)) return;

      // Ignore IME composition (CJK input, dead keys).
      if (event.isComposing || event.keyCode === 229) return;

      // All bindings require Alt.
      if (!event.altKey) return;

      const { code, shiftKey, ctrlKey, metaKey } = event;

      // Alt+Shift+Backspace → reject. Matched first because it requires shift.
      if (shiftKey && !ctrlKey && !metaKey && code === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        safeCall('rejectCurrent', target.rejectCurrent?.bind(target));
        return;
      }

      // Alt+Shift+Enter → acceptAll (opt-in: falls back to acceptCurrent).
      if (shiftKey && !ctrlKey && !metaKey && code === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof target.acceptAll === 'function') {
          safeCall('acceptAll', target.acceptAll?.bind(target));
        } else {
          safeCall('acceptCurrent', target.acceptCurrent?.bind(target));
        }
        return;
      }

      // Remaining bindings disallow extra modifiers.
      if (shiftKey || ctrlKey || metaKey) return;

      if (code === 'KeyJ') {
        event.preventDefault();
        event.stopPropagation();
        safeCall('focusNextHunk', target.focusNextHunk?.bind(target));
        return;
      }

      if (code === 'KeyK') {
        event.preventDefault();
        event.stopPropagation();
        safeCall('focusPrevHunk', target.focusPrevHunk?.bind(target));
        return;
      }

      if (code === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        safeCall('acceptCurrent', target.acceptCurrent?.bind(target));
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
    // diffViewerRef is a stable ref object; enabled toggles inside the closure.
  }, [diffViewerRef, enabled]);
}
