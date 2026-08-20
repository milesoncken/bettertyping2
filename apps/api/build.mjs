import { readFile } from "node:fs/promises";
import { build } from "esbuild";

/**
 * Bundle the API to plain JavaScript.
 *
 * The workspace packages are compiled *in* — they are TypeScript source with no
 * build output of their own, and shipping a Node service that needs a TypeScript
 * loader at runtime is a bad trade. Real dependencies stay external so they load
 * from node_modules as normal.
 */
const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

const external = Object.keys(pkg.dependencies ?? {}).filter(
  (name) => !name.startsWith("@bettertyping/"),
);

await build({
  entryPoints: ["src/index.ts", "src/migrate.ts", "src/dev-memory.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: [...external, "@electric-sql/pglite"],
  logLevel: "info",
});
