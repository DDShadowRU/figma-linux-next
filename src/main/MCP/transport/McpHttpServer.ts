import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { logger } from "Main/Logger";
import { MCP_HOST, MCP_PATH } from "../config";

export interface McpHttpServerStatus {
  listening: boolean;
  port: number;
}

export class McpHttpServer {
  private active: {
    server: Server;
    handler: McpHttpHandler;
    port: number;
  } | null = null;

  constructor(private readonly createHandler: () => McpHttpHandler) {}

  public getStatus(): McpHttpServerStatus {
    return {
      listening: this.active?.server.listening ?? false,
      port: this.active?.port ?? 0,
    };
  }

  public async start(port: number, host = MCP_HOST): Promise<void> {
    await this.stop();

    const handler = this.createHandler();
    const handleMcp = toNodeHandler(handler, {
      onerror: (error) => logger.warn(`[mcp] http: ${error.message}`),
    });
    const hostIsLocal = localhostHostValidation();
    const originIsLocal = localhostOriginValidation();

    const server = createServer((req, res) => {
      const path = (req.url ?? "").split("?", 1)[0];
      if (path !== MCP_PATH) {
        res.writeHead(404).end();
        return;
      }
      if (!hostIsLocal(req, res) || !originIsLocal(req, res)) return;
      void handleMcp(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    this.active = {
      server,
      handler,
      port: (server.address() as AddressInfo).port,
    };
  }

  public async stop(): Promise<void> {
    const active = this.active;
    this.active = null;
    if (!active) return;

    await active.handler.close();
    active.server.closeAllConnections();
    await new Promise<void>((resolve) => active.server.close(() => resolve()));
  }
}
