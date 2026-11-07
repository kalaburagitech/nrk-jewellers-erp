export type RecordSelectionState = {
  scope: string;
  auto: boolean;
  selected: Set<string>;
  excluded: Set<string>;
};
export function initialSelection(
  scope: string,
  auto = false,
): RecordSelectionState {
  return { scope, auto, selected: new Set(), excluded: new Set() };
}
/** Always intersect with visible IDs, so hidden or stale records cannot be acted on. */
export function selectedVisibleIds(
  state: RecordSelectionState,
  visibleIds: readonly string[],
): string[] {
  return visibleIds.filter((id) =>
    state.auto ? !state.excluded.has(id) : state.selected.has(id),
  );
}
export function toggleRecordSelection(
  state: RecordSelectionState,
  id: string,
): RecordSelectionState {
  const key = state.auto ? "excluded" : "selected";
  const next = new Set(state[key]);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...state, [key]: next };
}
