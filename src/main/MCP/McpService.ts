import { logger } from "Main/Logger";
import { MCP_HOST, MCP_PATH, MCP_PORT } from "./config";
import { McpFileRegistry } from "./files/McpFileRegistry";
import type { McpTabHost } from "./files/ports";
import { createFigmaMcpHandler } from "./server/createFigmaMcpHandler";
import { McpHttpServer, type McpHttpServerStatus } from "./transport/McpHttpServer";

/** What App talks to: lifecycle of the HTTP server plus the shared file registry behind it. */
export class McpService {
  private readonly files: McpFileRegistry;
  private readonly http: McpHttpServer;

  constructor(host: McpTabHost) {
    this.files = new McpFileRegistry(host);
    this.http = new McpHttpServer(() => createFigmaMcpHandler({ files: this.files }));
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
