declare module '@strudel/web' {
  export function initStrudel(options?: unknown): void | Promise<void>;
  export function evaluate(code: string): unknown;
  export function hush(): void;
  export function samples(sampleMap: string | Record<string, unknown>, baseUrl?: string): Promise<void>;
}
