import { homedir } from "node:os";
import * as path from "node:path";
import { app } from "electron";
import { logger } from "Main/Logger";
import { McpAssetStore } from "./assets/McpAssetStore";
import { ASSET_DIR_NAME, MCP_HOST, MCP_PATH, MCP_PORT } from "./config";
import { McpFileRegistry } from "./files/McpFileRegistry";
import type { McpTabHost } from "./files/ports";
import { createFigmaMcpHandler } from "./server/createFigmaMcpHandler";
import { McpHttpServer, type McpHttpServerStatus } from "./transport/McpHttpServer";

// A Flatpak sandbox gets a private /tmp that agents on the host cannot see;
// its XDG_CACHE_HOME (~/.var/app/<id>/cache) is the same path on both sides.
const resolveAssetRoot = () =>
  process.env.FLATPAK_ID
    ? path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"), ASSET_DIR_NAME)
    : path.join(app.getPath("temp"), ASSET_DIR_NAME);

/** What App talks to: lifecycle of the HTTP server plus the shared file registry behind it. */
export class McpService {
  private readonly files: McpFileRegistry;
  private readonly assets = new McpAssetStore(resolveAssetRoot());
  private readonly http: McpHttpServer;

  constructor(host: McpTabHost) {
    this.files = new McpFileRegistry(host);
    this.http = new McpHttpServer(() =>
      createFigmaMcpHandler({ files: this.files, assets: this.assets }),
    );
  }

  public async start(port = MCP_PORT): Promise<void> {
    try {
      await this.http.start(port);
      logger.info(`[mcp] listening on http://${MCP_HOST}:${port}${MCP_PATH}`);
    } catch (error) {
      logger.error(`[mcp] failed to start on port ${port}:`, error);
    }
  }

  public stop(): Promise<void> {
    return this.http.stop();
  }

  public restart(port: number): Promise<void> {
    return this.start(port);
  }

  public getStatus(): McpHttpServerStatus {
    return this.http.getStatus();
  }
}
