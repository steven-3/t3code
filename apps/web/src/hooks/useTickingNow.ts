import { useEffect, useState } from "react";

/**
 * Wall-clock milliseconds that advance while `active` is true.
 *
 * Live run displays age on their own — elapsed time grows and an agent goes
 * quiet — with no event to re-render them, so they need a clock. Ticking stops
 * as soon as nothing is running, leaving settled runs completely static.
 */
export function useTickingNow(active: boolean, intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timerId = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timerId);
  }, [active, intervalMs]);

  return now;
}
