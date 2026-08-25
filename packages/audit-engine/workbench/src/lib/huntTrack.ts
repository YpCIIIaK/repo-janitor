export type HuntTrack = "web3" | "web";
export const TRACK_COOKIE = "auditscout-track";

export function isHuntTrack(v: string | undefined): v is HuntTrack {
  return v === "web3" || v === "web";
}
