import { logger } from "Main/Logger";
import { McpFileError } from "../errors";
import { McpFileSession, type McpFileSessionOptions } from "./McpFileSession";
import type { McpTabHost } from "./ports";

/** All files currently open for agents, keyed by fileKey. Shared by every MCP client. */
export class McpFileRegistry {
  private readonly sessions = new Map<string, McpFileSession>();

  constructor(
    private readonly host: McpTabHost,
    private readonly sessionOptions: McpFileSessionOptions = {},
  ) {}

  public get size() {
    return this.sessions.size;
  }

  /** Open (or reuse) the tab for fileKey and wait until its Plugin API answers. */
  public async open(fileKey: string): Promise<McpFileSession> {
    const session = this.acquire(fileKey);
    try {
      await session.ensureReady();
    } catch (error) {
      if (
        error instanceof McpFileError &&
        (error.code === "not_found" || error.code === "no_access")
      ) {
        session.close();
      }
      throw error;
    }
    return session;
  }

  /**
   * Synchronous on purpose: two concurrent calls for the same fileKey must
   * both land on one session, so the tab is registered before anyone awaits.
   */
  public acquire(fileKey: string): McpFileSession {
    const existing = this.sessions.get(fileKey);
    if (existing?.isAlive) return existing;

    const tab = this.host.openFile(fileKey);
    if (!tab) {
      throw new McpFileError("no_window", "No Figma window is open");
    }

    const session = new McpFileSession(fileKey, tab, this.sessionOptions);
    this.sessions.set(fileKey, session);
    tab.onDestroyed(() => {
      if (this.sessions.get(fileKey) === session) {
        this.sessions.delete(fileKey);
        logger.info(`[mcp] tab ${tab.id} for ${fileKey} closed, session dropped`);
      }
    });
    logger.info(`[mcp] opened ${fileKey} in tab ${tab.id}`);

    return session;
  }
}
