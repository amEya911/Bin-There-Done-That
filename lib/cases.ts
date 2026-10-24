export function isCaseOpen(state?: string) {
  return !["work_complete", "rechecked", "resolved"].includes(
    state || "observed",
  );
}
