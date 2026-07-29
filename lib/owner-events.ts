/**
 * Browser event fired when the operator key is claimed or dropped.
 *
 * Its own module because the two sides are a client component and a hook, and
 * the key itself lives in an httpOnly cookie neither of them can read. There is
 * no shared state to subscribe to — only the fact that the answer changed, which
 * is what this announces.
 */
export const OWNER_CHANGED_EVENT = "repo-anti-rot:owner:changed"
