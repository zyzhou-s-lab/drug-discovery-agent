// Unit tests for the orchestrate primitives that don't need a model/network. runAgent's core logic
// (submit / retry / salvage) is covered offline by orchestrate.mock.test.ts; the live end-to-end
// path is covered by scripts/phase3-runagent-smoke.ts.
import { expect, test } from "bun:test";

import { Budget, CircuitBreaker, Semaphore } from "./orchestrate";

test("Semaphore bounds concurrency to its permit count", async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let maxActive = 0;
  const task = async () => {
    await sem.acquire();
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    sem.release();
  };
  await Promise.all([task(), task(), task(), task(), task()]);
  expect(maxActive).toBe(2);
  expect(active).toBe(0);
});

test("Semaphore releases waiters in FIFO order", async () => {
  const sem = new Semaphore(1);
  const order: number[] = [];
  await sem.acquire(); // hold the only permit
  const p1 = sem.acquire().then(() => order.push(1));
  const p2 = sem.acquire().then(() => order.push(2));
  sem.release(); // wakes p1
  await p1;
  sem.release(); // wakes p2
  await p2;
  expect(order).toEqual([1, 2]);
});

test("Budget is re-exported from orchestrate", () => {
  const b = new Budget(50);
  b.add("search", { input_tokens: 30, output_tokens: 20 });
  expect(b.exhausted()).toBe(true);
});

test("CircuitBreaker trips after N consecutive rate-limit failures; a success resets", () => {
  const b = new CircuitBreaker(3);
  b.note(true, "API Error: 429 rate limit");
  b.note(true, "quota exceeded");
  expect(b.tripped).toBe(false); // 2 < 3
  b.note(false); // success resets the streak
  b.note(true, "429");
  b.note(true, "429");
  expect(b.tripped).toBe(false); // reset back to 2
  b.note(true, "usage limit reached"); // 3rd consecutive → trip
  expect(b.tripped).toBe(true);
  expect(b.reason.toLowerCase()).toContain("usage limit");
});

test("CircuitBreaker ignores non-rate-limit errors (a bug shouldn't pause the run)", () => {
  const b = new CircuitBreaker(2);
  b.note(true, "TypeError: x is not a function");
  b.note(true, "some other failure");
  expect(b.tripped).toBe(false);
});

test("CircuitBreaker: a junk threshold (NaN/≤0) falls back to 8 — protection not disabled", () => {
  for (const bad of [NaN, 0, -1]) {
    const b = new CircuitBreaker(bad as any);
    for (let i = 0; i < 7; i++) b.note(true, "429");
    expect(b.tripped).toBe(false); // 7 < 8 default
    b.note(true, "429");
    expect(b.tripped).toBe(true); // 8th → trip
  }
});
