// Unit tests for the orchestrate primitives that don't need a model/network. runAgent's core logic
// (submit / retry / salvage) is covered offline by orchestrate.mock.test.ts; the live end-to-end
// path is covered by scripts/phase3-runagent-smoke.ts.
import { expect, test } from "bun:test";

import { Budget, Semaphore } from "./orchestrate";

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
