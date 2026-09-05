export type McpFileErrorCode =
  | "timeout"
  | "not_found"
  | "no_access"
  | "not_logged_in"
  | "tab_closed"
  | "no_window"
  | "plugin_api";

export class McpFileError extends Error {
  constructor(
    public readonly code: McpFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "McpFileError";
  }
}
