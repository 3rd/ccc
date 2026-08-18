import { spawn } from "node:child_process";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"];

export const replaceOrSpawnRuntimeHost = (nodeBinary, runtimeHostPath, forwardedArgs, environment) => {
  const args = [runtimeHostPath, ...forwardedArgs];
  if (typeof process.execve === "function") {
    process.execve(nodeBinary, [nodeBinary, ...args], environment);
    return;
  }

  const child = spawn(nodeBinary, args, { env: environment, stdio: "inherit" });
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => child.kill(signal));
  }
  child.once("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
};
