import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkPath } from "Utils/Main";

export interface WrittenAsset {
  path: string;
  uri: string;
  bytes: number;
}

export class McpAssetStore {
  private prepared: Promise<void> | null = null;

  constructor(public readonly root: string) {}

  public async createCallDir(): Promise<string> {
    this.prepared ??= this.prepare();
    await this.prepared;
    return mkdtemp(this.root + path.sep);
  }

  public resolveInside(uri: URL): string | null {
    try {
      const resolved = path.resolve(fileURLToPath(uri));
      return resolved.startsWith(this.root + path.sep) ? resolved : null;
    } catch {
      return null;
    }
  }

  public async write(
    dir: string,
    fileName: string,
    data: Uint8Array | string,
  ): Promise<WrittenAsset> {
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, data);
    const bytes =
      typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    return { path: filePath, uri: pathToFileURL(filePath).href, bytes };
  }

  private async prepare(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkPath(this.root);
  }
}
