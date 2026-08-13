import { randomUUID } from "crypto";

export const CCC_PRESEEDED_INSTANCE_ID_ENV = "CCC_PRESEEDED_INSTANCE_ID";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const prepareContextInstanceId = (
  env: NodeJS.ProcessEnv = process.env,
  createInstanceId: () => string = randomUUID,
) => {
  const preseededInstanceId = env[CCC_PRESEEDED_INSTANCE_ID_ENV];
  const instanceId =
    preseededInstanceId && UUID_PATTERN.test(preseededInstanceId)
      ? preseededInstanceId
      : createInstanceId();
  env[CCC_PRESEEDED_INSTANCE_ID_ENV] = instanceId;
  return instanceId;
};

export const consumeContextInstanceId = (
  env: NodeJS.ProcessEnv = process.env,
  createInstanceId: () => string = randomUUID,
) => {
  const preseededInstanceId = env[CCC_PRESEEDED_INSTANCE_ID_ENV];
  delete env[CCC_PRESEEDED_INSTANCE_ID_ENV];

  if (preseededInstanceId && UUID_PATTERN.test(preseededInstanceId)) {
    return preseededInstanceId;
  }

  return createInstanceId();
};
