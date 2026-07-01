import { describe, it, expect } from "vitest";
import { MessageGate } from "./messageGate.js";

// Guards the WS gateway race: messages that arrive before async setup finishes
// (a bid fired on `open`) must be delivered once the gate opens, never dropped.
describe("MessageGate", () => {
  it("buffers messages received before open() and flushes them in order", () => {
    const gate = new MessageGate<string>();
    gate.push("a");
    gate.push("b");

    const seen: string[] = [];
    gate.open((m) => seen.push(m));

    expect(seen).toEqual(["a", "b"]); // both early messages delivered, in order
  });

  it("passes messages received after open() straight through", () => {
    const gate = new MessageGate<string>();
    const seen: string[] = [];
    gate.open((m) => seen.push(m));

    gate.push("c");
    gate.push("d");
    expect(seen).toEqual(["c", "d"]);
  });

  it("preserves total order across the open() boundary", () => {
    const gate = new MessageGate<number>();
    gate.push(1);
    gate.push(2);
    const seen: number[] = [];
    gate.open((m) => seen.push(m));
    gate.push(3);

    expect(seen).toEqual([1, 2, 3]); // pre-open buffered, post-open live, one sequence
  });

  it("reports readiness", () => {
    const gate = new MessageGate<string>();
    expect(gate.isReady).toBe(false);
    gate.open(() => {});
    expect(gate.isReady).toBe(true);
  });

  it("does not drop a message pushed during nothing-buffered steady state", () => {
    const gate = new MessageGate<string>();
    const seen: string[] = [];
    gate.open((m) => seen.push(m));
    gate.push("only");
    expect(seen).toEqual(["only"]);
  });
});
