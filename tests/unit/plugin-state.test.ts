import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { createPluginState } from "@/plugins/state";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});

const createSession = () => {
  const directory = fs.mkdtempSync("/tmp/ccc-plugin-state-test-");
  const instanceId = crypto.randomUUID();
  const previous = process.env.CCC_INSTANCE_ID;
  process.env.CCC_INSTANCE_ID = instanceId;
  const state = createPluginState("synthetic", directory, "temp");
  if (previous === undefined) delete process.env.CCC_INSTANCE_ID;
  else process.env.CCC_INSTANCE_ID = previous;
  const path = `/tmp/ccc-plugin-synthetic-${instanceId}.json`;
  cleanup.push(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(path, { force: true });
    fs.rmSync(`${path}.lock`, { recursive: true, force: true });
  });
  return { state, path, directory, instanceId };
};

test("temp state requires initialization, distinguishes corrupt or missing storage, and clears explicitly", () => {
  const { state, path } = createSession();
  expect(() => state.getAll()).toThrow("unavailable");
  state.initialize();
  expect(state.getAll()).toEqual({});
  state.set("count", 1);
  const other = createSession().state;
  expect(() => other.getAll()).toThrow("unavailable");
  other.initialize();
  expect(other.getAll()).toEqual({});
  state.initialize();
  expect(state.get<number>("count")).toBe(1);
  fs.writeFileSync(path, "{");
  expect(() => state.getAll()).toThrow("unavailable");
  expect(() => state.initialize()).toThrow("unavailable");
  fs.writeFileSync(path, "[]");
  expect(() => state.getAll()).toThrow("unavailable");
  state.clear();
  expect(state.getAll()).toEqual({});
  fs.unlinkSync(path);
  expect(() => state.set("count", 2)).toThrow("unavailable");
  state.clear();
  expect(state.getAll()).toEqual({});
});

test("transaction errors and failed publication preserve the last complete state and stale revisions are rejected", () => {
  const { state, path } = createSession();
  state.initialize();
  state.set("count", 1);
  const snapshot = state.snapshot();
  expect(() => state.update((transaction) => {
    transaction.set("count", 2);
    throw new Error("Interrupted transition");
  })).toThrow("Interrupted transition");
  expect(state.snapshot()).toEqual(snapshot);
  const rename = spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("Publication failed"); });
  try {
    expect(() => state.set("count", 3)).toThrow("Publication failed");
  } finally {
    rename.mockRestore();
  }
  expect(JSON.parse(fs.readFileSync(path, "utf8"))).toEqual({ count: 1 });
  state.clear();
  state.set("count", 1);
  expect(() => state.update((transaction) => transaction.set("count", 4), snapshot.revision)).toThrow("changed");
  expect(state.getAll()).toEqual({ count: 1 });
});

test("separate concurrent writers fail visibly without lost updates and abandoned writes can be recovered", async () => {
  const { state, directory, instanceId } = createSession();
  state.initialize();
  state.set("count", 0);
  const launchWriter = () => Bun.spawn([process.execPath, "-e", `
    import { createPluginState } from ${JSON.stringify(import.meta.resolve("@/plugins/state"))};
    import { readSync, writeSync } from "node:fs";
    const state = createPluginState("synthetic", process.cwd(), "temp");
    state.update((transaction) => {
      const count = transaction.get("count");
      if (typeof count !== "number") throw new Error("Missing count");
      transaction.set("count", count + 1);
      writeSync(1, "locked");
      readSync(0, Buffer.alloc(1), 0, 1, null);
    });
  `], { cwd: directory, env: { ...process.env, CCC_INSTANCE_ID: instanceId }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  for (const disposition of ["commit", "interrupt"]) {
    const child = launchWriter();
    const errors = new Response(child.stderr).text();
    const reader = child.stdout.getReader();
    try {
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toBe("locked");
      expect(() => state.update((transaction) => transaction.set("count", 99))).toThrow("being updated");
      expect(state.get<number>("count")).toBe(disposition === "commit" ? 0 : 1);
      if (disposition === "commit") {
        child.stdin.write("x");
        child.stdin.end();
        expect(await child.exited).toBe(0);
      } else {
        child.kill("SIGKILL");
        await child.exited;
      }
      expect(await errors).toBe("");
    } finally {
      reader.releaseLock();
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }
  }
  expect(state.get<number>("count")).toBe(1);
  state.update((transaction) => transaction.set("count", 2));
  expect(state.get<number>("count")).toBe(2);
});

test("project state observes other instances while memory snapshots cannot mutate the owner", () => {
  const { directory } = createSession();
  const first = createPluginState("synthetic", directory, "project");
  const second = createPluginState("synthetic", directory, "project");
  expect(first.getAll()).toEqual({});
  second.set("count", 1);
  expect(first.get<number>("count")).toBe(1);
  second.clear();
  expect(first.getAll()).toEqual({});
  expect(fs.existsSync(join(directory, ".ccc/state/plugins/synthetic.json"))).toBe(false);
  const memory = createPluginState("synthetic", directory);
  memory.set("items", ["first"]);
  const snapshot = memory.get<string[]>("items");
  if (!snapshot) throw new Error("Missing memory value");
  snapshot.push("outside mutation");
  expect(memory.get<string[]>("items")).toEqual(["first"]);
});
