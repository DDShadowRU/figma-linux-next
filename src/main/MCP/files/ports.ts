export interface McpTabHandle {
  readonly id: number;
  exec(script: string): Promise<unknown>;
  getUrl(): string;
  isDestroyed(): boolean;
  isFocused(): boolean;
  onDestroyed(callback: () => void): void;
  close(): void;
}

export interface McpTabHost {
  openFile(fileKey: string): McpTabHandle | null;
}
