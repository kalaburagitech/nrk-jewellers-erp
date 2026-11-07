import { describe, expect, it } from "vitest";
import {
  initialSelection,
  selectedVisibleIds,
  toggleRecordSelection,
} from "./record-selection";
describe("record selection", () => {
  it("starts empty for record lists", () =>
    expect(selectedVisibleIds(initialSelection("boxes"), ["a", "b"])).toEqual(
      [],
    ));
  it("auto selects arriving results", () =>
    expect(
      selectedVisibleIds(initialSelection("invoice", true), ["a", "b"]),
    ).toEqual(["a", "b"]));
  it("keeps manual exclusions while automatically selecting new records", () => {
    const state = toggleRecordSelection(initialSelection("invoice", true), "a");
    expect(selectedVisibleIds(state, ["a", "b", "c"])).toEqual(["b", "c"]);
  });
  it("only includes visible records in a bulk action", () => {
    const state = {
      ...initialSelection("customers"),
      selected: new Set(["a", "hidden"]),
    };
    expect(selectedVisibleIds(state, ["a", "b"])).toEqual(["a"]);
  });
  it("supports deselecting and reselecting individual auto-selected rows", () => {
    const state = toggleRecordSelection(
      toggleRecordSelection(initialSelection("invoice", true), "a"),
      "a",
    );
    expect(selectedVisibleIds(state, ["a"])).toEqual(["a"]);
  });
});
