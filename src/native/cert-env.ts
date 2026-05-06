import { existsSync, statSync } from "fs";

const CERT_ENV_KEYS = [
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "NIX_SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
] as const;

interface NativeCertEnvDefaults {
  certDir?: string;
  certFile?: string;
}

const CERT_DIR_CANDIDATES: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: ["/etc/ssl/certs", "/etc/pki/tls/certs", "/etc/openssl/certs"],
  darwin: ["/etc/ssl/certs", "/opt/homebrew/etc/openssl@3/certs", "/usr/local/etc/openssl@3/certs"],
};

const CERT_FILE_CANDIDATES: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/ca-bundle.pem"],
  darwin: ["/etc/ssl/cert.pem", "/opt/homebrew/etc/ca-certificates/cert.pem", "/usr/local/etc/openssl@3/cert.pem"],
};

const pathIsDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const resolveNativeCertEnvDefaults = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean = existsSync,
  directoryExists: (path: string) => boolean = pathIsDirectory,
): NativeCertEnvDefaults | null => {
  if (CERT_ENV_KEYS.some((key) => Object.prototype.hasOwnProperty.call(env, key))) return null;

  const certDir = (CERT_DIR_CANDIDATES[platform] ?? []).find(directoryExists);
  const certFile = (CERT_FILE_CANDIDATES[platform] ?? []).find(pathExists);

  if (!certDir && !certFile) return null;
  return { certDir, certFile };
};

export const applyNativeCertEnvDefaults = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
  directoryExists: (path: string) => boolean = pathIsDirectory,
): NativeCertEnvDefaults | null => {
  const defaults = resolveNativeCertEnvDefaults(env, platform, pathExists, directoryExists);

  if (!defaults) return null;
  if (defaults.certDir) env.SSL_CERT_DIR = defaults.certDir;
  if (defaults.certFile) env.SSL_CERT_FILE = defaults.certFile;

  return defaults;
};
