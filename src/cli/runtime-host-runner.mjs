import { replaceOrSpawnRuntimeHost } from "./runtime-host-execution.mjs";

const nodeBinary = process.argv[2];
const runtimeHostPath = process.argv[3];
if (!nodeBinary || !runtimeHostPath) throw new Error("CCC runtime host command is required");

replaceOrSpawnRuntimeHost(nodeBinary, runtimeHostPath, process.argv.slice(4), process.env);
