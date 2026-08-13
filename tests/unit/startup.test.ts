import { describe, expect, test } from "bun:test";
import { createStartupLogger } from "@/utils/startup";

describe("StartupLogger", () => {
  test("prints boot duration and instance id when the first phase starts", () => {
    const lines: string[] = [];
    const startup = createStartupLogger({ enabled: true, write: (line) => lines.push(line) });
    startup.setInstanceId("8c1a5579-e892-4de8-b7a5-bc53dc43f1af");
    const task = startup.start("Resolve project context");

    const header = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
    expect(header[0]).toMatch(/^ccc — starting up \(boot \d+(ms|(\.\d)?s)\)\n$/);
    expect(header[1]).toBe("  instance id: 8c1a5579-e892-4de8-b7a5-bc53dc43f1af\n");
    expect(header).toHaveLength(2);

    task.done();

    const output = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
    expect(output[2]).toMatch(/^✔ Resolve project context \d+(ms|(\.\d)?s)\n$/);
    expect(output).toHaveLength(3);
  });
});
