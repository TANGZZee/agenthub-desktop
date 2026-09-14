declare module "better-sqlite3" {
  interface Statement {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  interface Database {
    pragma(sql: string): unknown;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
  const Database: { new(path: string): Database };
  export = Database;
}
