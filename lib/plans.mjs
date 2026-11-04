// Cloud storage per account, set with STORAGE_LIMIT_MB (default 500). Songs kept only on a device never count.
export const MB = 1024 * 1024, PLAN_SONGS = 200;
export const storageLimit = e => Math.max(1, Number(e?.STORAGE_LIMIT_MB) || 500) * MB;

export async function planFor(e) {
 return {plan: 'standard', limit_bytes: storageLimit(e), limit_songs: PLAN_SONGS};
}
