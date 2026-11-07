"use client";
import { useState } from "react";
import {
  initialSelection,
  selectedVisibleIds,
  toggleRecordSelection,
  type RecordSelectionState,
} from "@/lib/record-selection";
export function useRecordSelection(
  ids: readonly string[],
  scope: string,
  autoInitially = false,
) {
  const [stored, setStored] = useState(() =>
    initialSelection(scope, autoInitially),
  );
  const current =
    stored.scope === scope ? stored : initialSelection(scope, autoInitially);
  const selectedIds = selectedVisibleIds(current, ids);
  const selectedSet = new Set(selectedIds);
  function change(fn: (state: RecordSelectionState) => RecordSelectionState) {
    setStored((previous) =>
      fn(
        previous.scope === scope
          ? previous
          : initialSelection(scope, autoInitially),
      ),
    );
  }
  return {
    ids: selectedIds,
    count: selectedIds.length,
    total: ids.length,
    all: ids.length > 0 && selectedIds.length === ids.length,
    partial: selectedIds.length > 0 && selectedIds.length < ids.length,
    auto: current.auto,
    has: (id: string) => selectedSet.has(id),
    toggle: (id: string) => change((state) => toggleRecordSelection(state, id)),
    selectAll: (checked: boolean) =>
      change((state) => ({
        ...state,
        auto: checked ? state.auto : false,
        selected: new Set(checked ? ids : []),
        excluded: new Set(),
      })),
    setAuto: (auto: boolean) =>
      change(() => ({
        ...initialSelection(scope, auto),
        selected: new Set(auto ? [] : selectedIds),
      })),
    replace: (remaining: string[]) =>
      setStored({ ...initialSelection(scope), selected: new Set(remaining) }),
    clear: () => setStored(initialSelection(scope)),
  };
}
export type RecordSelection = ReturnType<typeof useRecordSelection>;
