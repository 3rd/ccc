import { describe, expect, mock, test } from "bun:test";
import {
  CCC_PRESEEDED_INSTANCE_ID_ENV,
  consumeContextInstanceId,
  prepareContextInstanceId,
} from "@/context/instance-id";

const PRESEEDED_INSTANCE_ID = "8c1a5579-e892-4de8-b7a5-bc53dc43f1af";
const GENERATED_INSTANCE_ID = "33a9fcdd-e6b7-4d82-bfc4-363938cfef28";

describe("prepareContextInstanceId", () => {
  test("reserves one generated id for context consumption", () => {
    const env: NodeJS.ProcessEnv = {};
    const createInstanceId = mock(() => GENERATED_INSTANCE_ID);

    expect(prepareContextInstanceId(env, createInstanceId)).toBe(GENERATED_INSTANCE_ID);
    expect(env).toEqual({ [CCC_PRESEEDED_INSTANCE_ID_ENV]: GENERATED_INSTANCE_ID });
    expect(consumeContextInstanceId(env, createInstanceId)).toBe(GENERATED_INSTANCE_ID);
    expect(createInstanceId).toHaveBeenCalledTimes(1);
    expect(env).toEqual({});
  });
});

describe("consumeContextInstanceId", () => {
  test("uses and removes a valid one-shot handoff", () => {
    const env: NodeJS.ProcessEnv = { [CCC_PRESEEDED_INSTANCE_ID_ENV]: PRESEEDED_INSTANCE_ID };
    const createInstanceId = mock(() => GENERATED_INSTANCE_ID);

    expect(consumeContextInstanceId(env, createInstanceId)).toBe(PRESEEDED_INSTANCE_ID);
    expect(createInstanceId).not.toHaveBeenCalled();
    expect(env).toEqual({});
  });

  test("keeps standalone identity generation unchanged", () => {
    const env = {
      AGENT_INSTANCE_ID: "parent-agent",
      CCC_INSTANCE_ID: "parent-ccc",
    };
    const createInstanceId = mock(() => GENERATED_INSTANCE_ID);

    expect(consumeContextInstanceId(env, createInstanceId)).toBe(GENERATED_INSTANCE_ID);
    expect(createInstanceId).toHaveBeenCalledTimes(1);
    expect(env).toEqual({
      AGENT_INSTANCE_ID: "parent-agent",
      CCC_INSTANCE_ID: "parent-ccc",
    });
  });

  test.each(["", "not-a-uuid", "../../session"])("rejects and removes an invalid handoff: %s", (value) => {
    const env: NodeJS.ProcessEnv = { [CCC_PRESEEDED_INSTANCE_ID_ENV]: value };

    expect(consumeContextInstanceId(env, () => GENERATED_INSTANCE_ID)).toBe(GENERATED_INSTANCE_ID);
    expect(env).toEqual({});
  });

  test("consumes the handoff only once", () => {
    const env: NodeJS.ProcessEnv = { [CCC_PRESEEDED_INSTANCE_ID_ENV]: PRESEEDED_INSTANCE_ID };
    const createInstanceId = mock(() => GENERATED_INSTANCE_ID);

    expect(consumeContextInstanceId(env, createInstanceId)).toBe(PRESEEDED_INSTANCE_ID);
    expect(consumeContextInstanceId(env, createInstanceId)).toBe(GENERATED_INSTANCE_ID);
    expect(createInstanceId).toHaveBeenCalledTimes(1);
  });
});
