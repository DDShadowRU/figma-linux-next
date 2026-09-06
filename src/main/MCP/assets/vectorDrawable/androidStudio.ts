import { existsSync } from "node:fs";
import * as path from "node:path";
import { logger } from "Main/Logger";

export interface AndroidStudio {
  java: string;
  classpath: string;
}

const REQUIRED_FILES = ["jbr/bin/java", "plugins/android/lib/sdk-common.jar"];
const CLASSPATH_DIRS = ["plugins/android/lib", "lib"];

let lastInvalidRoot: string | null = null;

/** Checked on every request; an invalid path is logged once per value, not per tools/list. */
export function resolveAndroidStudio(root: string): AndroidStudio | null {
  if (root === "") return null;
  if (REQUIRED_FILES.every((file) => existsSync(path.join(root, file)))) {
    return {
      java: path.join(root, "jbr", "bin", "java"),
      classpath: CLASSPATH_DIRS.map((dir) => path.join(root, dir, "*")).join(path.delimiter),
    };
  }
  if (lastInvalidRoot !== root) {
    lastInvalidRoot = root;
    logger.error(
      `[mcp] Android Studio path is invalid, VectorDrawable export is disabled: ${root} ` +
        `(expected ${REQUIRED_FILES.join(" and ")})`,
    );
  }
  return null;
}
