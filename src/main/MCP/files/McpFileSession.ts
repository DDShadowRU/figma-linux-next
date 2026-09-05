import { parseURL } from "Utils/Common";
import { FILE_OPEN_TIMEOUT_MS, PLUGIN_API_POLL_MS } from "../config";
import { McpFileError } from "../errors";
import { FILE_STATE_SCRIPT, TAB_STATE_SCRIPT } from "../scripts";
import type { McpTabHandle } from "./ports";

export interface McpFileSessionOptions {
  timeoutMs?: number;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isLoginUrl = (url: string) => parseURL(url)?.pathname === "/login";

interface FileState {
  ready: boolean;
  httpStatus: number | null;
}

const unavailableError = (status: number) => {
  if (status === 404) {
    return new McpFileError(
      "not_found",
      "Figma answered 404: the key is wrong, or the file was deleted or moved",
    );
  }
  if (status === 403) {
    return new McpFileError("no_access", "Figma answered 403: the signed-in account can't view it");
  }
  return new McpFileError("not_found", `Figma answered HTTP ${status}`);
};

/** One Figma file open in an [mcp] tab: readiness of its Plugin API and script execution. */
export class McpFileSession {
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private closed = false;
  private pluginApiReady = false;
  private readying: Promise<void> | null = null;

  constructor(
    public readonly fileKey: string,
    private readonly tab: McpTabHandle,
    options: McpFileSessionOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? FILE_OPEN_TIMEOUT_MS;
    this.pollMs = options.pollMs ?? PLUGIN_API_POLL_MS;
    tab.onDestroyed(() => {
      this.closed = true;
    });
  }

  public get tabId() {
    return this.tab.id;
  }

  public get isAlive() {
    return !this.closed && !this.tab.isDestroyed();
  }

  /**
   * Resolves once the Plugin API answers in this tab. Concurrent callers share
   * one wait. Re-probed on every call: Figma can park the Plugin API when the
   * tab has been shown and hidden again, so "was ready" is not "is ready".
   */
  public async ensureReady(): Promise<void> {
    this.assertAlive();
    if (this.pluginApiReady && (await this.probeFileState())?.ready) return;

    this.pluginApiReady = false;
    if (!this.readying) {
      this.readying = this.waitForPluginApi().finally(() => {
        this.readying = null;
      });
    }
    await this.readying;
  }

  public close() {
    this.tab.close();
  }

  public async execJson<T>(script: string): Promise<T> {
    await this.ensureReady();
    const raw = await this.tab.exec(script);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      throw new McpFileError("plugin_api", `Plugin API error: ${parsed.error}`);
    }
    return parsed as T;
  }

  private async waitForPluginApi(): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;

    while (true) {
      this.assertAlive();
      if (isLoginUrl(this.tab.getUrl())) {
        throw new McpFileError("not_logged_in", "Not signed in: Figma opened the login page");
      }
      const state = await this.probeFileState();
      if (state?.ready) {
        this.pluginApiReady = true;
        return;
      }
      if (state?.httpStatus && state.httpStatus >= 400) {
        throw unavailableError(state.httpStatus);
      }
      if (Date.now() >= deadline) {
        throw new McpFileError(
          "timeout",
          `Plugin API not ready after ${this.timeoutMs / 1000}s; the tab keeps loading, retry if the file is large ` +
            `(url: ${this.tab.getUrl()}, tab: ${await this.describeTab()})`,
        );
      }
      await sleep(this.pollMs);
    }
  }

  private async describeTab(): Promise<string> {
    try {
      return String(await this.tab.exec(TAB_STATE_SCRIPT));
    } catch (error) {
      return `unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async probeFileState(): Promise<FileState | null> {
    try {
      const raw = await this.tab.exec(FILE_STATE_SCRIPT);
      return typeof raw === "string" ? (JSON.parse(raw) as FileState) : null;
    } catch {
      return null;
    }
  }

  private assertAlive() {
    if (!this.isAlive) {
      throw new McpFileError("tab_closed", "The [mcp] tab was closed");
    }
  }
}
