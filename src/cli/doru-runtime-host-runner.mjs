import { replaceOrSpawnRuntimeHost } from "./runtime-host-execution.mjs";

const DORU_RUNTIME_HOST_PAYLOAD_ENV = "CCC_DORU_RUNTIME_HOST_PAYLOAD";

const isStringArray = (value) => {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
};

const parsePayload = () => {
  const serialized = process.env[DORU_RUNTIME_HOST_PAYLOAD_ENV];
  if (!serialized) throw new Error("CCC Doru runtime host payload is missing");

  const value = JSON.parse(serialized);
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.nodeBinary !== "string" ||
    value.nodeBinary.length === 0 ||
    typeof value.runtimeHostPath !== "string" ||
    value.runtimeHostPath.length === 0 ||
    !isStringArray(value.forwardedArgs)
  ) {
    throw new Error("CCC Doru runtime host payload is invalid");
  }

  return value;
};

const payload = parsePayload();
delete process.env[DORU_RUNTIME_HOST_PAYLOAD_ENV];
replaceOrSpawnRuntimeHost(payload.nodeBinary, payload.runtimeHostPath, payload.forwardedArgs, process.env);
