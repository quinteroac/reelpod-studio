import { createInterface } from "node:readline";

export async function defaultReadLine(): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      terminal: false,
    });

    let settled = false;

    const settle = (value: string | null): void => {
      if (!settled) {
        settled = true;
        rl.close();
        resolve(value);
      }
    };

    rl.once("line", settle);
    rl.once("close", () => settle(null));
  });
}
