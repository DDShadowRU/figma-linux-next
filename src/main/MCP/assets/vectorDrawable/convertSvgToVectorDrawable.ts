import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { logger } from "Main/Logger";
import type { AndroidStudio } from "./androidStudio";
import shimSource from "./Svg2VectorShim.java?raw";

const execFileAsync = promisify(execFile);
const SHIM_FILE = "Svg2VectorShim.java";
const JVM_TIMEOUT_MS = 60_000;

export type VectorDrawableResult = { xml: string; warning?: string } | { error: string };

/**
 * Converts `<dir>/<name>.svg` into `<dir>/<name>.xml` for every name in one JVM run. The shim
 * leaves `<name>.log` next to an input the converter complained about or gave up on.
 */
export async function convertSvgToVectorDrawable(
  studio: AndroidStudio,
  dir: string,
  names: string[],
): Promise<Map<string, VectorDrawableResult>> {
  const shim = path.join(dir, SHIM_FILE);
  await writeFile(shim, shimSource);
  const inputs = names.map((name) => path.join(dir, `${name}.svg`));
  try {
    await execFileAsync(studio.java, ["-cp", studio.classpath, shim, dir, ...inputs], {
      timeout: JVM_TIMEOUT_MS,
    });
  } catch (error) {
    const message = describeFailure(error);
    logger.warn(`[mcp] Svg2Vector run failed: ${message}`);
    return new Map(names.map((name): [string, VectorDrawableResult] => [name, { error: message }]));
  }

  const results = new Map<string, VectorDrawableResult>();
  for (const name of names) {
    const xml = await readOptional(path.join(dir, `${name}.xml`));
    const log = (await readOptional(path.join(dir, `${name}.log`)))?.trim();
    if (xml === null) results.set(name, { error: log || "the converter produced no output" });
    else results.set(name, log ? { xml, warning: log } : { xml });
  }
  return results;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function describeFailure(error: unknown): string {
  const failure = error as { killed?: boolean; stderr?: string; message?: string };
  if (failure.killed) return `the converter timed out after ${JVM_TIMEOUT_MS / 1000}s`;
  const stderr = failure.stderr?.trim().split("\n").slice(-3).join(" ").trim();
  return stderr || failure.message || String(error);
}
