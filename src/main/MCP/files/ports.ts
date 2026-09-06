export interface McpTabHandle {
  readonly id: number;
  exec(script: string): Promise<unknown>;
  getUrl(): string;
  isDestroyed(): boolean;
  isFocused(): boolean;
  onDestroyed(callback: () => void): void;
  /** Whether an agent's call is running in the tab; drives the panel's activity indicator. */
  setBusy(busy: boolean): void;
  close(): void;
}

export interface McpTabHost {
  openFile(fileKey: string): McpTabHandle | null;
}
