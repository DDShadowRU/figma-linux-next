import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { mkPath } from "Utils/Main";

export class McpAssetStore {
  private prepared: Promise<void> | null = null;

  constructor(public readonly root: string) {}

  public async createCallDir(): Promise<string> {
    this.prepared ??= this.prepare();
    await this.prepared;
    return mkdtemp(this.root + path.sep);
  }

  public async write(dir: string, fileName: string, data: Uint8Array | string): Promise<string> {
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, data);
    return filePath;
  }

  private async prepare(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkPath(this.root);
  }
}
