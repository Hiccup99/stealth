import { describe, it, expect, beforeEach } from "vitest";
import { associateStore } from "@/store/associateStore";

describe("associateStore", () => {
  beforeEach(() => {
    associateStore.setState({
      isActive: false,
      state: "idle",
      currentQuery: "",
      cursorPosition: { x: 0, y: 0 },
    });
  });

  it("activates and sets state to listening", () => {
    associateStore.getState().activate();
    const { isActive, state } = associateStore.getState();
    expect(isActive).toBe(true);
    expect(state).toBe("listening");
  });

  it("deactivates and resets", () => {
    associateStore.getState().activate();
    associateStore.getState().deactivate();
    const { isActive, state, currentQuery } = associateStore.getState();
    expect(isActive).toBe(false);
    expect(state).toBe("idle");
    expect(currentQuery).toBe("");
  });

  it("updates cursor position", () => {
    associateStore.getState().setCursorPosition(100, 200);
    expect(associateStore.getState().cursorPosition).toEqual({ x: 100, y: 200 });
  });
});
