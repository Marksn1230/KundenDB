declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;
  export class DatabaseSync {
    constructor(path: string, options?: {readOnly?:boolean});
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      get(...params: Value[]): Record<string, unknown> | undefined;
      all(...params: Value[]): Record<string, unknown>[];
      run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    };
  }
}
