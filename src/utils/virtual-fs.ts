/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-explicit-any */
import childProcessDefault, {
  type ChildProcess,
  type ExecException,
  type ExecFileOptions,
  type ExecOptions,
  type ExecSyncOptions,
  type ForkOptions,
  type SpawnOptions,
  type SpawnSyncOptions,
} from "child_process";
import fsDefault, {
  type Dir,
  type Dirent,
  type OpenDirOptions,
  type PathLike,
  type StatSyncOptions,
} from "fs";
import { Volume } from "memfs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import * as os from "os";
import * as path from "path";
import { ensureFileExists } from "./fs";
import { log } from "./log";

type ReadFileSyncOptions = BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null;
type ReaddirSyncOptions =
  | BufferEncoding
  | { encoding?: BufferEncoding | null; withFileTypes?: boolean; recursive?: boolean }
  | null;
type ReadDirOptions =
  | BufferEncoding
  | { encoding: BufferEncoding | null; withFileTypes?: false | undefined; recursive?: boolean | undefined }
  | null;

const monkeyPatchFS = ({
  vol,
  commandsPath,
  virtualCommands,
  workingDirectory,
  disableParentClaudeMds,
  agentsPath,
  virtualAgents,
}: {
  vol: Volume;
  commandsPath?: string;
  virtualCommands?: string[];
  workingDirectory?: string;
  disableParentClaudeMds?: boolean;
  agentsPath?: string;
  virtualAgents?: string[];
}) => {
  const normalizedCommandsPath = commandsPath ? path.normalize(path.resolve(commandsPath)) : undefined;
  const normalizedAgentsPath = agentsPath ? path.normalize(path.resolve(agentsPath)) : undefined;

  const isCommandsPath = (filePath: unknown): boolean => {
    if (!normalizedCommandsPath || typeof filePath !== "string") return false;
    const normalized = path.normalize(path.resolve(filePath));
    const result =
      normalized === normalizedCommandsPath ||
      normalized === normalizedCommandsPath + path.sep ||
      normalizedCommandsPath === normalized + path.sep;
    if (result) log.vfs(`isCommandsPath: "${filePath}" => true (normalized: "${normalized}")`);
    return result;
  };

  const isCommandsChild = (filePath: unknown): boolean => {
    if (!normalizedCommandsPath || typeof filePath !== "string") return false;
    const normalized = path.normalize(path.resolve(filePath));
    const result = normalized.startsWith(normalizedCommandsPath + path.sep);
    if (result) log.vfs(`isCommandsChild: "${filePath}" => true`);
    return result;
  };

  const isAgentsPath = (filePath: unknown): boolean => {
    if (!normalizedAgentsPath || typeof filePath !== "string") return false;
    const normalized = path.normalize(path.resolve(filePath));
    const result =
      normalized === normalizedAgentsPath ||
      normalized === normalizedAgentsPath + path.sep ||
      normalizedAgentsPath === normalized + path.sep;
    if (result) log.vfs(`isAgentsPath: "${filePath}" => true (normalized: "${normalized}")`);
    return result;
  };

  const isAgentsChild = (filePath: unknown): boolean => {
    if (!normalizedAgentsPath || typeof filePath !== "string") return false;
    const normalized = path.normalize(path.resolve(filePath));
    const result = normalized.startsWith(normalizedAgentsPath + path.sep);
    if (result) log.vfs(`isAgentsChild: "${filePath}" => true`);
    return result;
  };

  const origSpawn = childProcessDefault.spawn;
  const origSpawnSync = childProcessDefault.spawnSync;
  const origExec = childProcessDefault.exec;
  const origExecSync = childProcessDefault.execSync;
  const origExecFile = childProcessDefault.execFile;
  const origExecFileSync = childProcessDefault.execFileSync;
  const origFork = childProcessDefault.fork;
  const origReadFileSync = fsDefault.readFileSync;
  const origExistsSync = fsDefault.existsSync;
  const origStatSync = fsDefault.statSync;
  const origReaddirSync = fsDefault.readdirSync;
  const origOpendirSync = fsDefault.opendirSync;

  (childProcessDefault as any).spawn = function (
    command: string,
    cmdArgs?: SpawnOptions | readonly string[],
    options?: SpawnOptions,
  ): ChildProcess {
    log.shell(command, Array.isArray(cmdArgs) ? cmdArgs : []);
    return origSpawn.call(this, command, cmdArgs as any, options as any);
  };
  (childProcessDefault as any).spawnSync = function (
    command: string,
    cmdArgs?: SpawnSyncOptions | readonly string[],
    options?: SpawnSyncOptions,
  ) {
    log.shell(`spawnSync: ${command}`, Array.isArray(cmdArgs) ? cmdArgs : []);
    return origSpawnSync.call(this, command, cmdArgs as any, options);
  };
  (childProcessDefault as any).exec = function (
    command: string,
    options?: ExecOptions | ((error: ExecException | null, stdout: string, stderr: string) => void),
    callback?: (error: ExecException | null, stdout: string, stderr: string) => void,
  ): ChildProcess {
    log.shell(`exec: ${command}`);
    return origExec.call(this, command, options as any, callback as any);
  };
  (childProcessDefault as any).execSync = function (
    command: string,
    options?: ExecSyncOptions,
  ): Buffer | string {
    log.shell(`execSync: ${command}`);
    return origExecSync.call(this, command, options);
  };
  (childProcessDefault as any).fork = function (
    modulePath: string,
    args?: readonly string[],
    options?: ForkOptions,
  ): ChildProcess {
    log.shell(`fork: ${modulePath}`, (args || []) as any);
    return origFork.call(this, modulePath, args as any, options);
  };

  fsDefault.readFileSync = function (filePath: PathLike | number, options?: ReadFileSyncOptions) {
    // check if this is a CLAUDE.md file read that should be intercepted
    if (
      disableParentClaudeMds &&
      workingDirectory &&
      typeof filePath === "string" &&
      path.basename(filePath) === "CLAUDE.md"
    ) {
      const resolvedPath = path.resolve(filePath);
      const resolvedWorkingDir = path.resolve(workingDirectory);
      const fileDir = path.dirname(resolvedPath);

      // check if the CLAUDE.md is in a parent directory (not the current working directory)
      if (fileDir !== resolvedWorkingDir && resolvedWorkingDir.startsWith(fileDir)) {
        log.vfs(`Intercepting parent CLAUDE.md read: "${filePath}" (opt-out enabled, returning empty)`);
        if (options && ((typeof options === "object" && options.encoding) || typeof options === "string")) {
          return "";
        }
        return Buffer.from("");
      }
    }

    if (
      (typeof filePath === "string" || Buffer.isBuffer(filePath)) &&
      (isCommandsPath(filePath) ||
        isCommandsChild(filePath) ||
        isAgentsPath(filePath) ||
        isAgentsChild(filePath))
    ) {
      try {
        if (vol.existsSync(filePath)) {
          const result = vol.readFileSync(filePath, options as Parameters<typeof vol.readFileSync>[1]);
          const resultInfo =
            Buffer.isBuffer(result) ? `${result.length} bytes` : `${result.toString().length} chars`;
          log.vfs(`readFileSync("${filePath}") => ${resultInfo} (virtual)`);
          return result;
        }
      } catch (error_) {
        log.vfs(`readFileSync("${filePath}") => ERROR: ${error_} (virtual)`);
      }
      const error = new Error(
        `ENOENT: no such file or directory, open '${filePath}'`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      error.path = String(filePath);
      log.vfs(`readFileSync("${filePath}") => throwing ENOENT (not in virtual fs)`);
      throw error;
    }
    try {
      if ((typeof filePath === "string" || Buffer.isBuffer(filePath)) && vol.existsSync(filePath)) {
        return vol.readFileSync(filePath, options as Parameters<typeof vol.readFileSync>[1]);
      }
    } catch {}
    // @ts-expect-error
    return Reflect.apply(origReadFileSync, this, [filePath, options]);
  } as typeof fsDefault.readFileSync;
  fsDefault.existsSync = function (filePath: PathLike): boolean {
    if (
      isCommandsPath(filePath) ||
      isCommandsChild(filePath) ||
      isAgentsPath(filePath) ||
      isAgentsChild(filePath)
    ) {
      const result = vol.existsSync(filePath);
      log.vfs(`existsSync("${filePath}") => ${result} (virtual only)`);
      return result;
    }
    if ((typeof filePath === "string" || Buffer.isBuffer(filePath)) && vol.existsSync(filePath)) return true;
    return Reflect.apply(origExistsSync, this, [filePath]) as boolean;
  };
  // @ts-expect-error
  fsDefault.statSync = function (filePath: PathLike, options?: StatSyncOptions) {
    if (typeof filePath === "string" && filePath.includes(".claude/commands")) {
      log.vfs(`statSync("${filePath}") called`);
    }
    if (
      isCommandsPath(filePath) ||
      isCommandsChild(filePath) ||
      isAgentsPath(filePath) ||
      isAgentsChild(filePath)
    ) {
      try {
        if (vol.existsSync(filePath)) {
          return vol.statSync(filePath) as ReturnType<typeof fsDefault.statSync>;
        }
      } catch {}
      const error = new Error(
        `ENOENT: no such file or directory, stat '${filePath}'`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      error.path = String(filePath);
      throw error;
    }
    try {
      if ((typeof filePath === "string" || Buffer.isBuffer(filePath)) && vol.existsSync(filePath)) {
        return vol.statSync(filePath) as ReturnType<typeof fsDefault.statSync>;
      }
    } catch {}
    // @ts-expect-error
    return Reflect.apply(origStatSync, this, [filePath, options]);
  } as typeof fsDefault.statSync;
  fsDefault.readdirSync = function (filePath: PathLike, options?: ReaddirSyncOptions) {
    type ReaddirResult = Buffer[] | Dirent[] | string[];
    log.vfs(`readdirSync("${filePath}") called`);
    if (isCommandsPath(filePath)) {
      log.vfs(`Commands dir read, yielding virtual files only`);
      try {
        if (vol.existsSync(filePath)) {
          const result = vol.readdirSync(
            filePath,
            options as Parameters<typeof vol.readdirSync>[1],
          ) as ReaddirResult;
          log.vfs(`readdirSync("${filePath}") => [${result}] (${result.length} files, virtual only)`);
          return result;
        }
      } catch (error) {
        log.vfs(`readdirSync("${filePath}") => ERROR: ${error}`);
      }
      log.vfs(`readdirSync("${filePath}") => [] (empty, virtual only)`);
      return [];
    }
    if (isAgentsPath(filePath)) {
      log.vfs(`Agents dir read, yielding virtual files only`);
      try {
        if (vol.existsSync(filePath)) {
          const result = vol.readdirSync(
            filePath,
            options as Parameters<typeof vol.readdirSync>[1],
          ) as ReaddirResult;
          log.vfs(`readdirSync("${filePath}") => [${result}] (${result.length} files, virtual only)`);
          return result;
        }
      } catch (error) {
        log.vfs(`readdirSync("${filePath}") => ERROR: ${error}`);
      }
      log.vfs(`readdirSync("${filePath}") => [] (empty, virtual only)`);
      return [];
    }
    let realFiles: ReaddirResult = [];
    try {
      // @ts-expect-error
      realFiles = Reflect.apply(origReaddirSync, this, [filePath, options]) as ReaddirResult;
    } catch {}
    let virtualFiles: ReaddirResult = [];
    try {
      if ((typeof filePath === "string" || Buffer.isBuffer(filePath)) && vol.existsSync(filePath)) {
        virtualFiles = vol.readdirSync(
          filePath,
          options as Parameters<typeof vol.readdirSync>[1],
        ) as ReaddirResult;
      }
    } catch {}
    if (virtualFiles.length === 0) return realFiles;
    if (realFiles.length === 0) return virtualFiles;
    const withFileTypes = typeof options === "object" && options?.withFileTypes;
    if (withFileTypes) {
      const fileMap = new Map<string, Dirent>();
      for (const dirent of realFiles as Dirent[]) fileMap.set(dirent.name, dirent);
      for (const dirent of virtualFiles as Dirent[]) fileMap.set(dirent.name, dirent);
      return Array.from(fileMap.values());
    }
    const merged = new Set<Buffer | string>([
      ...(realFiles as (Buffer | string)[]),
      ...(virtualFiles as (Buffer | string)[]),
    ]);
    return Array.from(merged);
  } as typeof fsDefault.readdirSync;
  fsDefault.readdir = function (
    filePath: PathLike,
    options?: ReadDirOptions,
    callback?: (err: NodeJS.ErrnoException | null, files?: Buffer[] | Dirent[] | string[]) => void,
  ) {
    if (typeof filePath === "string" && filePath.includes(".claude")) {
      log.vfs(`readdir("${filePath}") async called`);
    }
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    const cb = callback || (() => {});
    try {
      const result = fsDefault.readdirSync(filePath, options);
      process.nextTick(() => cb(null, result));
    } catch (error: unknown) {
      process.nextTick(() => cb(error as NodeJS.ErrnoException));
    }
  } as typeof fsDefault.readdir;
  fsDefault.opendirSync = function (filePath: PathLike, options?: OpenDirOptions): Dir {
    if (typeof filePath === "string" && filePath.includes(".claude")) {
      log.vfs(`opendirSync("${filePath}") called`);
    }
    if (isCommandsPath(filePath)) {
      log.vfs(`opendirSync caught for commands, returning virtual Dir`);
      const files = vol.existsSync(filePath) ? vol.readdirSync(filePath) : [];
      log.vfs(`Virtual Dir will contain: ${files}`);
      const createDirent = (name: string) => {
        const stats = vol.statSync(path.join(String(filePath), name));
        return {
          name,
          parentPath: String(filePath),
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isDirectory: () => stats.isDirectory(),
          isFIFO: () => false,
          isFile: () => stats.isFile(),
          isSocket: () => false,
          isSymbolicLink: () => false,
        } as any;
      };
      let index = 0;
      const dir = {
        path: String(filePath),
        read: (callback?: (err: NodeJS.ErrnoException | null, dirent: Dirent | null) => void) => {
          log.vfs(`Dir.read() called, returning file ${index} of ${files.length}`);
          if (callback) {
            if (index < files.length) {
              const dirent = createDirent(String(files[index++]));
              process.nextTick(() => callback(null, dirent));
              return dirent;
            }
            process.nextTick(() => callback(null, null));
            return null;
          }
          return null;
        },
        readSync: () => {
          log.vfs(`Dir.readSync() called, returning file ${index} of ${files.length}`);
          if (index < files.length) {
            return createDirent(String(files[index++])) as any;
          }
          return null;
        },
        close: (callback?: (err?: NodeJS.ErrnoException | null) => void) => {
          log.vfs(`Dir.close() called`);
          if (callback) process.nextTick(() => callback(null));
        },
        closeSync: () => {
          log.vfs(`Dir.closeSync() called`);
        },
        async *[Symbol.asyncIterator]() {
          log.vfs(`Dir async iterator called, yielding ${files.length} files`);
          for (const file of files) {
            yield createDirent(String(file));
          }
        },
        *[Symbol.iterator]() {
          log.vfs(`Dir sync iterator called, yielding ${files.length} files`);
          for (const file of files) {
            yield createDirent(String(file));
          }
        },
      };
      return dir as unknown as Dir;
    }
    if (isAgentsPath(filePath)) {
      log.vfs(`opendirSync caught for agents, returning virtual Dir`);
      const files = vol.existsSync(filePath) ? vol.readdirSync(filePath) : [];
      log.vfs(`Virtual Dir will contain: ${files}`);
      const createDirent = (name: string) => {
        const stats = vol.statSync(path.join(String(filePath), name));
        return {
          name,
          parentPath: String(filePath),
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isDirectory: () => stats.isDirectory(),
          isFIFO: () => false,
          isFile: () => stats.isFile(),
          isSocket: () => false,
          isSymbolicLink: () => false,
        } as Dirent;
      };
      let index = 0;
      const dir = {
        path: String(filePath),
        read: (callback?: (err: NodeJS.ErrnoException | null, dirent: Dirent | null) => void) => {
          log.vfs(`Dir.read() called, returning file ${index} of ${files.length}`);
          if (callback) {
            if (index < files.length) {
              const dirent = createDirent(String(files[index++]));
              process.nextTick(() => callback(null, dirent));
              return dirent;
            }
            process.nextTick(() => callback(null, null));
            return null;
          }
          return null;
        },
        readSync: () => {
          log.vfs(`Dir.readSync() called, returning file ${index} of ${files.length}`);
          if (index < files.length) {
            return createDirent(String(files[index++])) as any;
          }
          return null;
        },
        close: (callback?: (err?: NodeJS.ErrnoException | null) => void) => {
          log.vfs(`Dir.close() called`);
          if (callback) process.nextTick(() => callback(null));
        },
        closeSync: () => {
          log.vfs(`Dir.closeSync() called`);
        },
        async *[Symbol.asyncIterator]() {
          log.vfs(`Dir async iterator called, yielding ${files.length} files`);
          for (const file of files) {
            yield createDirent(String(file));
          }
        },
        *[Symbol.iterator]() {
          log.vfs(`Dir sync iterator called, yielding ${files.length} files`);
          for (const file of files) {
            yield createDirent(String(file));
          }
        },
      };
      return dir as unknown as Dir;
    }
    // @ts-expect-error
    return Reflect.apply(origOpendirSync, this, [filePath, options]);
  } as typeof fsDefault.opendirSync;
  fsDefault.opendir = function (
    filePath: PathLike,
    options?: OpenDirOptions,
    callback?: (err: NodeJS.ErrnoException | null, dir?: Dir) => void,
  ) {
    if (typeof filePath === "string" && filePath.includes(".claude")) {
      log.vfs(`opendir("${filePath}") async called`);
    }
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    const cb = callback || (() => {});
    try {
      const dir = fsDefault.opendirSync(filePath, options);
      process.nextTick(() => cb(null, dir));
    } catch (error: unknown) {
      process.nextTick(() => cb(error as NodeJS.ErrnoException));
    }
  } as typeof fsDefault.opendir;

  const isProtectedPath = (filePath: unknown): boolean => {
    if (typeof filePath !== "string") return false;
    const normalized = path.normalize(path.resolve(filePath));
    const homeDir = os.homedir();

    const protectedPaths = [
      path.join(homeDir, ".claude", "settings.json"),
      path.join(homeDir, ".claude", "CLAUDE.md"),
      path.join(homeDir, ".claude", "output-styles", "custom.md"),
    ];
    if (protectedPaths.includes(normalized)) {
      log.vfs(`WRITE BLOCKED: Protected file "${filePath}"`);
      return true;
    }
    if (isCommandsPath(filePath) || isCommandsChild(filePath)) {
      log.vfs(`WRITE BLOCKED: Commands directory "${filePath}"`);
      return true;
    }
    if (isAgentsPath(filePath) || isAgentsChild(filePath)) {
      log.vfs(`WRITE BLOCKED: Agents directory "${filePath}"`);
      return true;
    }

    return false;
  };

  const createPermissionError = (operation: string, filePath: string): NodeJS.ErrnoException => {
    const error = new Error(`EACCES: permission denied, ${operation} '${filePath}'`) as NodeJS.ErrnoException;
    error.code = "EACCES";
    error.path = String(filePath);
    return error;
  };

  const origWriteFileSync = fsDefault.writeFileSync;
  fsDefault.writeFileSync = function (
    this: typeof fsDefault,
    filePath: PathLike | number,
    data: any,
    options?: any,
  ) {
    if (isProtectedPath(filePath)) {
      throw createPermissionError("open", String(filePath));
    }
    return Reflect.apply(origWriteFileSync, this, [filePath, data, options]);
  } as typeof fsDefault.writeFileSync;

  const origWriteFile = fsDefault.writeFile;
  fsDefault.writeFile = function (
    this: typeof fsDefault,
    filePath: PathLike | number,
    data: any,
    optionsOrCallback?: any,
    callback?: any,
  ) {
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
      optionsOrCallback = undefined;
    }
    const cb = callback || (() => {});

    if (isProtectedPath(filePath)) {
      const error = createPermissionError("open", String(filePath));
      process.nextTick(() => cb(error));
      return;
    }

    return Reflect.apply(origWriteFile, this, [filePath, data, optionsOrCallback, cb]);
  } as typeof fsDefault.writeFile;

  const origAppendFileSync = fsDefault.appendFileSync;
  fsDefault.appendFileSync = function (
    this: typeof fsDefault,
    filePath: PathLike | number,
    data: any,
    options?: any,
  ) {
    if (isProtectedPath(filePath)) {
      throw createPermissionError("open", String(filePath));
    }
    return Reflect.apply(origAppendFileSync, this, [filePath, data, options]);
  } as typeof fsDefault.appendFileSync;

  const origAppendFile = fsDefault.appendFile;
  fsDefault.appendFile = function (
    this: typeof fsDefault,
    filePath: PathLike | number,
    data: any,
    optionsOrCallback?: any,
    callback?: any,
  ) {
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
      optionsOrCallback = undefined;
    }
    const cb = callback || (() => {});

    if (isProtectedPath(filePath)) {
      const error = createPermissionError("open", String(filePath));
      process.nextTick(() => cb(error));
      return;
    }

    return Reflect.apply(origAppendFile, this, [filePath, data, optionsOrCallback, cb]);
  } as typeof fsDefault.appendFile;

  const origUnlinkSync = fsDefault.unlinkSync;
  fsDefault.unlinkSync = function (this: typeof fsDefault, filePath: PathLike) {
    if (isProtectedPath(filePath)) {
      throw createPermissionError("unlink", String(filePath));
    }
    return Reflect.apply(origUnlinkSync, this, [filePath]);
  } as typeof fsDefault.unlinkSync;

  const origUnlink = fsDefault.unlink;
  fsDefault.unlink = function (
    this: typeof fsDefault,
    filePath: PathLike,
    callback?: (err: NodeJS.ErrnoException | null) => void,
  ) {
    const cb = callback || (() => {});

    if (isProtectedPath(filePath)) {
      const error = createPermissionError("unlink", String(filePath));
      process.nextTick(() => cb(error));
      return;
    }

    return Reflect.apply(origUnlink, this, [filePath, cb]);
  } as typeof fsDefault.unlink;

  const origRmdirSync = fsDefault.rmdirSync;
  fsDefault.rmdirSync = function (this: typeof fsDefault, filePath: PathLike, options?: any) {
    if (isProtectedPath(filePath)) {
      throw createPermissionError("rmdir", String(filePath));
    }
    return Reflect.apply(origRmdirSync, this, [filePath, options]);
  } as typeof fsDefault.rmdirSync;

  const origRmdir = fsDefault.rmdir;
  fsDefault.rmdir = function (
    this: typeof fsDefault,
    filePath: PathLike,
    optionsOrCallback?: any,
    callback?: (err: NodeJS.ErrnoException | null) => void,
  ) {
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
      optionsOrCallback = undefined;
    }
    const cb = callback || (() => {});

    if (isProtectedPath(filePath)) {
      const error = createPermissionError("rmdir", String(filePath));
      process.nextTick(() => cb(error));
      return;
    }

    return Reflect.apply(origRmdir, this, [filePath, optionsOrCallback, cb]);
  } as typeof fsDefault.rmdir;

  const origRenameSync = fsDefault.renameSync;
  fsDefault.renameSync = function (this: typeof fsDefault, oldPath: PathLike, newPath: PathLike) {
    if (isProtectedPath(oldPath) || isProtectedPath(newPath)) {
      throw createPermissionError("rename", String(oldPath));
    }
    return Reflect.apply(origRenameSync, this, [oldPath, newPath]);
  } as typeof fsDefault.renameSync;

  const origRename = fsDefault.rename;
  fsDefault.rename = function (
    this: typeof fsDefault,
    oldPath: PathLike,
    newPath: PathLike,
    callback?: (err: NodeJS.ErrnoException | null) => void,
  ) {
    const cb = callback || (() => {});

    if (isProtectedPath(oldPath) || isProtectedPath(newPath)) {
      const error = createPermissionError("rename", String(oldPath));
      process.nextTick(() => cb(error));
      return;
    }

    return Reflect.apply(origRename, this, [oldPath, newPath, cb]);
  } as typeof fsDefault.rename;

  const origTruncateSync = fsDefault.truncateSync;
  fsDefault.truncateSync = function (this: typeof fsDefault, filePath: PathLike, len?: number | null) {
    if (isProtectedPath(filePath)) {
      throw createPermissionError("open", String(filePath));
    }
    return Reflect.apply(origTruncateSync, this, [filePath, len]);
  } as typeof fsDefault.truncateSync;

  const origTruncate = fsDefault.truncate;
  fsDefault.truncate = function (
    this: typeof fsDefault,
    filePath: PathLike,
    lenOrCallback?: ((err: NodeJS.ErrnoException | null) => void) | number | null,
    callback?: (err: NodeJS.ErrnoException | null) => void,
  ) {
    let len: number | null | undefined;
    let cb: ((err: NodeJS.ErrnoException | null) => void) | undefined;

    if (typeof lenOrCallback === "function") {
      cb = lenOrCallback;
      len = 0;
    } else {
      len = lenOrCallback;
      cb = callback;
    }

    if (isProtectedPath(filePath)) {
      const error = createPermissionError("open", String(filePath));
      if (cb) process.nextTick(() => cb(error));
      return;
    }

    return Reflect.apply(origTruncate, this, [filePath, len, cb]);
  } as typeof fsDefault.truncate;

  const origCreateWriteStream = fsDefault.createWriteStream;
  fsDefault.createWriteStream = function (this: typeof fsDefault, filePath: PathLike, options?: any) {
    if (isProtectedPath(filePath)) {
      throw createPermissionError("open", String(filePath));
    }
    return Reflect.apply(origCreateWriteStream, this, [filePath, options]);
  } as typeof fsDefault.createWriteStream;
  if (fsDefault.promises) {
    const origPromisesWriteFile = fsDefault.promises.writeFile;
    Object.defineProperty(fsDefault.promises, "writeFile", {
      async value(filePath: PathLike, data: any, options?: any) {
        if (isProtectedPath(filePath)) {
          throw createPermissionError("open", String(filePath));
        }
        return origPromisesWriteFile.call(this, filePath, data, options);
      },
      writable: true,
      configurable: true,
    });

    const origPromisesAppendFile = fsDefault.promises.appendFile;
    Object.defineProperty(fsDefault.promises, "appendFile", {
      async value(filePath: PathLike, data: any, options?: any) {
        if (isProtectedPath(filePath)) {
          throw createPermissionError("open", String(filePath));
        }
        return origPromisesAppendFile.call(this, filePath, data, options);
      },
      writable: true,
      configurable: true,
    });

    const origPromisesUnlink = fsDefault.promises.unlink;
    Object.defineProperty(fsDefault.promises, "unlink", {
      async value(filePath: PathLike) {
        if (isProtectedPath(filePath)) {
          throw createPermissionError("unlink", String(filePath));
        }
        return origPromisesUnlink.call(this, filePath);
      },
      writable: true,
      configurable: true,
    });

    const origPromisesRmdir = fsDefault.promises.rmdir;
    Object.defineProperty(fsDefault.promises, "rmdir", {
      async value(filePath: PathLike, options?: any) {
        if (isProtectedPath(filePath)) {
          throw createPermissionError("rmdir", String(filePath));
        }
        return origPromisesRmdir.call(this, filePath, options);
      },
      writable: true,
      configurable: true,
    });

    const origPromisesRename = fsDefault.promises.rename;
    Object.defineProperty(fsDefault.promises, "rename", {
      async value(oldPath: PathLike, newPath: PathLike) {
        if (isProtectedPath(oldPath) || isProtectedPath(newPath)) {
          throw createPermissionError("rename", String(oldPath));
        }
        return origPromisesRename.call(this, oldPath, newPath);
      },
      writable: true,
      configurable: true,
    });

    const origPromisesTruncate = fsDefault.promises.truncate;
    Object.defineProperty(fsDefault.promises, "truncate", {
      async value(filePath: PathLike, len?: number) {
        if (isProtectedPath(filePath)) {
          throw createPermissionError("open", String(filePath));
        }
        return origPromisesTruncate.call(this, filePath, len);
      },
      writable: true,
      configurable: true,
    });

    const origPromisesReaddir = fsDefault.promises.readdir;
    Object.defineProperty(fsDefault.promises, "readdir", {
      async value(filePath: PathLike, options?: ReadDirOptions) {
        if (typeof filePath === "string" && filePath.includes(".claude")) {
          log.vfs(`fs.promises.readdir("${filePath}") called`);
        }
        if (isCommandsPath(filePath)) {
          log.vfs(`fs.promises.readdir intercepted for commands directory`);
          if (vol.existsSync(filePath)) {
            return vol.readdirSync(filePath, options as any);
          }
          return [];
        }
        if (isAgentsPath(filePath)) {
          log.vfs(`fs.promises.readdir intercepted for agents directory`);
          if (vol.existsSync(filePath)) {
            return vol.readdirSync(filePath, options as any);
          }
          return [];
        }
        return origPromisesReaddir.call(this, filePath, options as any);
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(fsDefault.promises, "opendir", {
      async value(filePath: PathLike, options?: OpenDirOptions) {
        if (typeof filePath === "string" && filePath.includes(".claude")) {
          log.vfs(`fs.promises.opendir("${filePath}") called`);
        }
        return fsDefault.opendirSync(filePath, options);
      },
      writable: true,
      configurable: true,
    });
    type FsPromisesWithGlob = {
      glob?: (pattern: string, options?: unknown) => Promise<string[]>;
    } & typeof fsDefault.promises;
    const fsPromisesWithGlob = fsDefault.promises as FsPromisesWithGlob;
    if (fsPromisesWithGlob.glob) {
      const origPromisesGlob = fsPromisesWithGlob.glob;
      Object.defineProperty(fsDefault.promises, "glob", {
        async value(pattern: string, ...restArgs: unknown[]) {
          log.vfs(`fs.promises.glob called with pattern: ${pattern}`);
          if (pattern && (pattern.includes(".claude/commands") || pattern.includes("~/.claude/commands"))) {
            log.vfs(`fs.promises.glob intercepted for commands directory`);
            if (vol.existsSync(normalizedCommandsPath!)) {
              const files = vol.readdirSync(normalizedCommandsPath!);
              return files.map((f) => path.join(normalizedCommandsPath!, String(f)));
            }
            return [];
          }
          return Reflect.apply(origPromisesGlob, this, [pattern, ...restArgs]);
        },
        writable: true,
        configurable: true,
      });
    }
  }
  if ((fsDefault as any).glob) {
    const origGlob = (fsDefault as any).glob;
    (fsDefault as any).glob = function (pattern: string, ...restArgs: unknown[]) {
      log.vfs(`fs.glob called with pattern: ${pattern}`);
      return Reflect.apply(origGlob, this, [pattern, ...restArgs]);
    };
  }
  if ((fsDefault as any).globSync) {
    const origGlobSync = (fsDefault as any).globSync;
    (fsDefault as any).globSync = function (pattern: string, ...restArgs: unknown[]) {
      log.vfs(`fs.globSync called with pattern: ${pattern}`);
      if (pattern && (pattern.includes(".claude/commands") || pattern.includes("~/.claude/commands"))) {
        log.vfs(`fs.globSync intercepted for commands directory`);
        if (vol.existsSync(normalizedCommandsPath!)) {
          const files = vol.readdirSync(normalizedCommandsPath!);
          return files.map((f) => path.join(normalizedCommandsPath!, String(f)));
        }
        return [];
      }
      return Reflect.apply(origGlobSync, this, [pattern, ...restArgs]);
    };
  }
  if ((fsDefault as any).walk) {
    const origWalk = (fsDefault as any).walk;
    (fsDefault as any).walk = function (filePath: string, ...restArgs: unknown[]) {
      log.vfs(`fs.walk called with: ${filePath}`);
      return Reflect.apply(origWalk, this, [filePath, ...restArgs]);
    };
  }
  if ((fsDefault as any).scandir) {
    const origScandir = (fsDefault as any).scandir;
    (fsDefault as any).scandir = function (filePath: string, ...restArgs: unknown[]) {
      log.vfs(`fs.scandir called with: ${filePath}`);
      return Reflect.apply(origScandir, this, [filePath, ...restArgs]);
    };
  }

  const allFsMethods = Object.getOwnPropertyNames(fsDefault);
  const alreadyPatched = new Set([
    "existsSync",
    "lstatSync",
    "opendir",
    "opendirSync",
    "readdir",
    "readdirSync",
    "readFileSync",
    "realpathSync",
    "statSync",
  ]);

  for (const method of allFsMethods) {
    const original = (fsDefault as Record<string, unknown>)[method];
    if (typeof original === "function" && !alreadyPatched.has(method)) {
      (fsDefault as Record<string, unknown>)[method] = function (this: typeof fsDefault, ...args: unknown[]) {
        if (
          method.toLowerCase().includes("dir") ||
          method.toLowerCase().includes("read") ||
          method.toLowerCase().includes("scan") ||
          method.toLowerCase().includes("walk") ||
          method.toLowerCase().includes("glob") ||
          method.toLowerCase().includes("list")
        ) {
          log.vfs(`Unpatched fs.${method}() called!`);
          if (args[0] && typeof args[0] === "string" && args[0].includes(".claude")) {
            log.vfs(`fs.${method}("${args[0]}") on .claude path!`);
          }
          if (method === "readSync" && typeof args[0] === "number") {
            log.vfs(`fs.readSync(fd=${args[0]}, buffer, ...) - low-level read on file descriptor`);
          }
        }
        if (args[0] && typeof args[0] === "string" && args[0].includes(".claude/commands")) {
          log.vfs(`fs.${method}("${args[0]}") called on commands path`);
        }
        return original.apply(this, args);
      };
    }
  }

  if (fsDefault.openSync) {
    const origOpenSync = fsDefault.openSync;
    (fsDefault as any).openSync = function (
      filePath: PathLike,
      flags: number | string,
      mode?: number | string,
    ) {
      if (typeof filePath === "string") {
        log.vfs(`openSync("${filePath}", flags=${flags}) called`);
        if (filePath.includes(".claude/commands")) {
          log.vfs(`Commands dir open as file descriptor`);
        }
      }
      return Reflect.apply(origOpenSync, this, [filePath, flags, mode]);
    };
  }

  if (fsDefault.lstatSync) {
    const origLstatSync = fsDefault.lstatSync;
    Object.defineProperty(fsDefault, "lstatSync", {
      value(filePath: PathLike, options?: StatSyncOptions) {
        if (typeof filePath === "string" && filePath.includes(".claude")) {
          log.vfs(`lstatSync("${filePath}") called`);
        }
        return Reflect.apply(origLstatSync, this, [filePath, options]);
      },
      writable: true,
      configurable: true,
    });
  }

  if (fsDefault.realpathSync) {
    const origRealpathSync = fsDefault.realpathSync;
    const patchedRealpathSync = function (
      this: any,
      filePath: PathLike,
      options?: BufferEncoding | { encoding?: BufferEncoding | null },
    ) {
      if (typeof filePath === "string" && filePath.includes(".claude")) {
        log.vfs(`realpathSync("${filePath}") called`);
      }
      return Reflect.apply(origRealpathSync, this, [filePath, options]);
    } as typeof fsDefault.realpathSync;
    patchedRealpathSync.native = origRealpathSync.native;
    fsDefault.realpathSync = patchedRealpathSync;
  }

  const origProcessBinding = process.binding;
  (process as unknown as Record<string, unknown>).binding = function (name: string) {
    if (name === "fs") {
      log.vfs(`WARNING: process.binding('fs') called - native fs access attempted`);
    }
    return origProcessBinding.call(this, name);
  };

  try {
    const require = createRequire(import.meta.url);
    const Module = require("module");
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (id: string) {
      if (id === "fs" || id === "fs/promises" || id === "node:fs" || id === "node:fs/promises") {
        log.vfs(`require('${id}') called - returning patched fs`);
        if (id === "fs/promises" || id === "node:fs/promises") {
          return fsDefault.promises;
        }
        return fsDefault;
      }
      return Reflect.apply(origRequire, this, [id]);
    };
  } catch (error) {
    log.vfs(`Could not patch require: ${error}`);
  }

  (childProcessDefault as any).execFile = function (
    file: string,
    args?: ExecFileOptions | readonly string[] | null,
    optionsOrCallback?:
      | ExecFileOptions
      | ((error: ExecException | null, stdout: string, stderr: string) => void),
    callback?: (error: ExecException | null, stdout: string, stderr: string) => void,
  ): ChildProcess {
    log.shell(`execFile: ${file}`, Array.isArray(args) ? Array.from(args) : []);
    // mock ripgrep output when it scans for commands
    if (
      commandsPath &&
      virtualCommands &&
      virtualCommands.length > 0 &&
      file &&
      ["rg", "ripgrep"].includes(basename(file)) &&
      args
    ) {
      const argsArray = Array.isArray(args) ? Array.from(args) : [];
      const hasCommandsPath = argsArray.some(
        (arg) => arg.includes(".claude/commands") || arg === commandsPath || arg === normalizedCommandsPath,
      );
      if (hasCommandsPath) {
        log.vfs(`Caught ripgrep call for listing commands`);
        log.vfs(`  Command: ${file}`);
        log.vfs(`  Args: ${JSON.stringify(argsArray)}`);
        log.vfs(`  Returning virtual commands: ${virtualCommands.join(", ")}`);
        const callbackFn = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
        if (callbackFn) {
          const output = virtualCommands.map((cmd) => path.join(commandsPath, cmd)).join("\n");
          process.nextTick(() => {
            callbackFn(null, output, "");
          });
          return {
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            on: (event: string, handler: Function) => {
              if (event === "close" || event === "exit") {
                process.nextTick(() => handler(0));
              }
            },
            kill: () => true,
            pid: 99_999,
          } as unknown as ChildProcess;
        }
      }
    }

    // intercept ripgrep calls for listing agents
    if (
      agentsPath &&
      virtualAgents &&
      virtualAgents.length > 0 &&
      file &&
      ["rg", "ripgrep"].includes(basename(file)) &&
      args
    ) {
      const argsArray = Array.isArray(args) ? Array.from(args) : [];
      const hasAgentsPath = argsArray.some(
        (arg) => arg.includes(".claude/agents") || arg === agentsPath || arg === normalizedAgentsPath,
      );
      if (hasAgentsPath) {
        log.vfs(`Caught ripgrep call for listing agents`);
        log.vfs(`  Command: ${file}`);
        log.vfs(`  Args: ${JSON.stringify(argsArray)}`);
        log.vfs(`  Returning virtual agents: ${virtualAgents.join(", ")}`);
        const callbackFn = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
        if (callbackFn) {
          const output = virtualAgents.map((agent) => path.join(agentsPath, agent)).join("\n");
          process.nextTick(() => {
            callbackFn(null, output, "");
          });
          return {
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            on: (event: string, handler: Function) => {
              if (event === "close" || event === "exit") {
                process.nextTick(() => handler(0));
              }
            },
            kill: () => true,
            pid: 99_999,
          } as unknown as ChildProcess;
        }
      }
    }

    return origExecFile.call(this, file, args as any, optionsOrCallback as any, callback as any);
  };
  (childProcessDefault as any).execFileSync = function (
    file: string,
    args?: readonly string[] | null,
    options?: ExecSyncOptions,
  ): Buffer | string {
    log.shell(`execFileSync: ${file}`, Array.isArray(args) ? Array.from(args) : []);
    if (
      commandsPath &&
      virtualCommands &&
      virtualCommands.length > 0 &&
      file &&
      ["rg", "ripgrep"].includes(basename(file)) &&
      args
    ) {
      const argsArray = Array.isArray(args) ? Array.from(args) : [];
      const hasCommandsPath = argsArray.some(
        (arg) => arg.includes(".claude/commands") || arg === commandsPath || arg === normalizedCommandsPath,
      );
      if (hasCommandsPath) {
        log.vfs(`Caught ripgrep sync call for listing commands`);
        log.vfs(`  Command: ${file}`);
        log.vfs(`  Args: ${JSON.stringify(argsArray)}`);
        log.vfs(`  Returning virtual commands: ${virtualCommands.join(", ")}`);
        return virtualCommands.map((cmd) => path.join(commandsPath, cmd)).join("\n");
      }
    }
    return origExecFileSync.call(this, file, args as any, options);
  };
  syncBuiltinESMExports();
};

export const setupVirtualFileSystem = (args: {
  settings: Record<string, unknown>;
  systemPrompt: string;
  userPrompt: string;
  commands?: Map<string, string>;
  agents?: Map<string, string>;
  workingDirectory?: string;
  disableParentClaudeMds?: boolean;
}): void => {
  const settingsJsonPath = path.join(os.homedir(), ".claude", "settings.json");
  const outputStylePath = path.join(os.homedir(), ".claude", "output-styles", "custom.md");
  const claudeMdPath = path.join(os.homedir(), ".claude", "CLAUDE.md");
  const commandsPath = path.normalize(path.resolve(os.homedir(), ".claude", "commands"));
  const agentsPath = path.normalize(path.resolve(os.homedir(), ".claude", "agents"));

  log.vfs("Initializing virtual filesystem");

  // log settings
  log.vfs("Injecting settings.json:");
  log.vfs(`  Path: ${settingsJsonPath}`);
  const settingsKeys = Object.keys(args.settings);
  log.vfs(`  Keys: ${settingsKeys.join(", ")}`);
  for (const key of settingsKeys) {
    const value = args.settings[key];
    if (typeof value === "object" && value !== null) {
      log.vfs(`    ${key}: ${JSON.stringify(value, null, 2).split("\n").join("\n      ")}`);
    } else {
      log.vfs(`    ${key}: ${value}`);
    }
  }

  // log system prompt
  const systemPromptFirstLine = args.systemPrompt.split("\n")[0] || "";
  log.vfs(
    `Injecting system prompt: "${systemPromptFirstLine.slice(0, 80)}${systemPromptFirstLine.length > 80 ? "..." : ""}"`,
  );
  log.vfs(`  Path: ${outputStylePath}`);
  log.vfs(`  Length: ${args.systemPrompt.length} chars, ${args.systemPrompt.split("\n").length} lines`);

  // log user prompt
  const userPromptFirstLine = args.userPrompt.split("\n")[0] || "";
  log.vfs(
    `Injecting user prompt: "${userPromptFirstLine.slice(0, 80)}${userPromptFirstLine.length > 80 ? "..." : ""}"`,
  );
  log.vfs(`  Path: ${claudeMdPath}`);
  log.vfs(`  Length: ${args.userPrompt.length} chars, ${args.userPrompt.split("\n").length} lines`);

  // log commands
  log.vfs(`Commands path: ${commandsPath}`);
  if (args.commands) {
    log.vfs(`Commands to inject: ${args.commands.size} files`);
    for (const [filename, content] of args.commands) {
      log.vfs(`  - ${filename} (${content.length} chars)`);
    }
  } else {
    log.vfs("No commands provided");
  }

  // log agents
  log.vfs(`Agents path: ${agentsPath}`);
  if (args.agents) {
    log.vfs(`Agents to inject: ${args.agents.size} files`);
    for (const [filename, content] of args.agents) {
      log.vfs(`  - ${filename} (${content.length} chars)`);
    }
  } else {
    log.vfs("No agents provided");
  }

  const vol = Volume.fromJSON({
    [settingsJsonPath]: JSON.stringify(args.settings, null, 2),
    [outputStylePath]: args.systemPrompt,
    [claudeMdPath]: args.userPrompt,
  });

  // add commands to virtual volume if provided
  const virtualCommandFiles: string[] = [];
  if (args.commands) {
    // ensure commands directory exists in virtual volume
    vol.mkdirSync(commandsPath, { recursive: true });

    for (const [filename, content] of args.commands) {
      const filePath = path.join(commandsPath, filename);
      vol.writeFileSync(filePath, content);
      virtualCommandFiles.push(filename);
    }

    log.vfs("Commands written to virtual volume");
    log.vfs(`Virtual directory contents: ${vol.readdirSync(commandsPath)}`);
  }

  // add agents to virtual volume if provided
  const virtualAgentFiles: string[] = [];
  if (args.agents) {
    // ensure agents directory exists in virtual volume
    vol.mkdirSync(agentsPath, { recursive: true });

    for (const [filename, content] of args.agents) {
      const filePath = path.join(agentsPath, filename);
      vol.writeFileSync(filePath, content);
      virtualAgentFiles.push(filename);
    }

    log.vfs("Agents written to virtual volume");
    log.vfs(`Virtual directory contents: ${vol.readdirSync(agentsPath)}`);
  }

  // ensure files exists - workaround for discovery issues
  // TODO: remove since we can monkey patch now
  ensureFileExists(outputStylePath);
  ensureFileExists(claudeMdPath);

  monkeyPatchFS({
    vol,
    commandsPath: args.commands ? commandsPath : undefined,
    virtualCommands: virtualCommandFiles,
    workingDirectory: args.workingDirectory,
    disableParentClaudeMds: args.disableParentClaudeMds,
    agentsPath: args.agents ? agentsPath : undefined,
    virtualAgents: virtualAgentFiles,
  });
};
