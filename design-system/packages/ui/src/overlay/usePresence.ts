import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../internal/useReducedMotion";

export type PresenceState = "entering" | "entered" | "exiting";

export interface PresenceSnapshot {
  present: boolean;
  state: PresenceState;
}

export function usePresence(open: boolean, exitDurationMs: number): PresenceSnapshot {
  const [present, setPresent] = useState(open);
  const [state, setState] = useState<PresenceState>(open ? "entered" : "exiting");
  const stateRef = useRef(state);
  stateRef.current = state;
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setPresent(open);
      setState(open ? "entered" : "exiting");
      return;
    }
    if (open) {
      setPresent(true);
      // An interrupted exit still has a rendered surface. Reverse its transition
      // from the current painted value instead of resetting to the entrance pose.
      if (present && stateRef.current === "exiting") {
        setState("entered");
        return;
      }
      setState("entering");
      const view = typeof window === "undefined" ? null : window;
      if (!view) {
        setState("entered");
        return;
      }
      let firstFrame = 0;
      let secondFrame = 0;
      firstFrame = view.requestAnimationFrame(() => {
        secondFrame = view.requestAnimationFrame(() => setState("entered"));
      });
      return () => {
        view.cancelAnimationFrame(firstFrame);
        view.cancelAnimationFrame(secondFrame);
      };
    }

    if (!present) return;
    setState("exiting");
    const view = typeof window === "undefined" ? null : window;
    if (!view) {
      setPresent(false);
      return;
    }
    const timer = view.setTimeout(() => setPresent(false), exitDurationMs);
    return () => view.clearTimeout(timer);
  }, [exitDurationMs, open, present, reducedMotion]);

  return { present, state };
}
