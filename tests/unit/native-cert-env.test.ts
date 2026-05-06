import { describe, expect, test } from "bun:test";
import { applyNativeCertEnvDefaults } from "@/native/cert-env";

const existing = (paths: string[]) => (path: string) => paths.includes(path);
const CERT_ENV_KEYS = [
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "NIX_SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
] as const;

describe("native cert env defaults", () => {
  for (const key of CERT_ENV_KEYS) {
    test(`preserves explicit ${key} env`, () => {
      const env: NodeJS.ProcessEnv = { [key]: "" };
      const defaults = applyNativeCertEnvDefaults(
        env,
        "linux",
        existing(["/etc/ssl/certs/ca-certificates.crt"]),
        existing(["/etc/ssl/certs"]),
      );

      expect(defaults).toBeNull();
    });
  }

  test("selects linux system cert paths when present", () => {
    const defaults = applyNativeCertEnvDefaults(
      {},
      "linux",
      existing(["/etc/ssl/certs/ca-certificates.crt"]),
      existing(["/etc/ssl/certs"]),
    );

    expect(defaults).toEqual({
      certDir: "/etc/ssl/certs",
      certFile: "/etc/ssl/certs/ca-certificates.crt",
    });
  });

  test("selects macOS Homebrew cert paths when system paths are absent", () => {
    const defaults = applyNativeCertEnvDefaults(
      {},
      "darwin",
      existing(["/opt/homebrew/etc/ca-certificates/cert.pem"]),
      existing(["/opt/homebrew/etc/openssl@3/certs"]),
    );

    expect(defaults).toEqual({
      certDir: "/opt/homebrew/etc/openssl@3/certs",
      certFile: "/opt/homebrew/etc/ca-certificates/cert.pem",
    });
  });

  test("does nothing on platforms without known cert paths", () => {
    const defaults = applyNativeCertEnvDefaults({}, "win32", () => true, () => true);

    expect(defaults).toBeNull();
  });

  test("applies resolved env values", () => {
    const env: NodeJS.ProcessEnv = {};
    const defaults = applyNativeCertEnvDefaults(env, process.platform);

    if (!defaults) {
      expect(env.SSL_CERT_DIR).toBeUndefined();
      expect(env.SSL_CERT_FILE).toBeUndefined();
      return;
    }

    expect(env.SSL_CERT_DIR).toBe(defaults.certDir);
    expect(env.SSL_CERT_FILE).toBe(defaults.certFile);
  });
});
