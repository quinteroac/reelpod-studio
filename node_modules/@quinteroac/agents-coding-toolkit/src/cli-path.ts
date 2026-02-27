import { join } from "node:path";

/** Path to the CLI entrypoint. Resolves correctly when the package is installed as a dependency. */
export const CLI_PATH = join(import.meta.dir, "cli.ts");
