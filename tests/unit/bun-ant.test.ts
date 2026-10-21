import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyBunAntAddonEnv } from "@/native/bun-ant";
import { buildGraphPreambleModule } from "@/native/preamble";

describe.if(process.platform === "linux")("Bun.ant add-on", () => {
  test("reports the connecting process's pid and uid and clears dumpable through the graph preamble", () => {
    const directory = mkdtempSync(join(tmpdir(), "ccc-bun-ant-"));

    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CCC_CLAUDE_WRAPPER_PKG_JSON: fileURLToPath(new URL("../../package.json", import.meta.url)),
      };
      expect(applyBunAntAddonEnv(env)).toEndWith(".node");

      const scriptPath = join(directory, "preamble.mjs");
      writeFileSync(scriptPath, `${buildGraphPreambleModule([])}
const net = __baseRequire("net");
const { spawn } = __baseRequire("child_process");
const { statSync } = __baseRequire("fs");
const socketName = "ccc-bun-ant-test-" + process.pid;
const environOwnerBefore = statSync("/proc/self/environ").uid;
const isDumpableCleared = __cccBun.ant.setDumpable(false);
const environOwnerAfter = statSync("/proc/self/environ").uid;
let client;
const server = net.createServer((socket) => {
  const descriptor = socket._handle.fd;
  console.log(JSON.stringify({
    clientPid: client.pid,
    peerPid: __cccBun.ant.getPeerPid(descriptor),
    peerUid: __cccBun.ant.getPeerUid(descriptor),
    uid: process.getuid(),
    isDumpableCleared,
    environOwnerBefore,
    environOwnerAfter,
  }));
  socket.destroy();
  server.close();
  client.kill();
});
server.listen("\\0" + socketName, () => {
  client = spawn(process.execPath, ["-e", "require('net').connect('\\\\0' + process.argv[1]); setInterval(() => {}, 1000)", socketName], { stdio: "ignore" });
});
`);
      const result = spawnSync("node", [scriptPath], { cwd: directory, env, encoding: "utf8", timeout: 10_000 });

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.peerPid).toBe(report.clientPid);
      expect(report.peerUid).toBe(report.uid);
      expect(report.isDumpableCleared).toBe(true);
      expect(report.environOwnerBefore).toBe(report.uid);
      expect(report.environOwnerAfter).not.toBe(report.uid);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
