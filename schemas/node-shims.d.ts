declare module "fs" {
  export function readFileSync(path: string, encoding: string): string;
}

declare module "path" {
  export function join(...paths: string[]): string;
}

declare const process: {
  exitCode?: number;
};

interface ImportMeta {
  readonly dir: string;
}
