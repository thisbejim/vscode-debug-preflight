import { existsSync } from "node:fs";

if (!existsSync(new URL("../dist/cli.js", import.meta.url)) ||
    !existsSync(new URL("../dist/audit.js", import.meta.url))) {
  process.stderr.write("Compiled CLI files are missing. Run `npm run build` before packing or installing from Git.\n");
  process.exit(1);
}
