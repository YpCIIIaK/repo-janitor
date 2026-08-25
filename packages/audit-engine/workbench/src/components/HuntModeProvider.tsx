"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { TRACK_COOKIE, type HuntTrack } from "@/lib/huntTrack";

export type { HuntTrack };
export { TRACK_COOKIE };

type HuntModeValue = {
  track: HuntTrack;
  setTrack: (t: HuntTrack) => void;
};

const HuntModeContext = createContext<HuntModeValue | null>(null);

export function HuntModeProvider({
  initialTrack,
  children,
}: {
  initialTrack: HuntTrack;
  children: React.ReactNode;
}) {
  const [track, setTrackState] = useState<HuntTrack>(initialTrack);
  const setTrack = useCallback((t: HuntTrack) => {
    setTrackState(t);
    document.cookie = `${TRACK_COOKIE}=${t}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);
  const value = useMemo(() => ({ track, setTrack }), [track, setTrack]);
  return <HuntModeContext.Provider value={value}>{children}</HuntModeContext.Provider>;
}

export function useHuntMode() {
  const v = useContext(HuntModeContext);
  if (!v) throw new Error("useHuntMode outside provider");
  return v;
}

export { isHuntTrack } from "@/lib/huntTrack";
