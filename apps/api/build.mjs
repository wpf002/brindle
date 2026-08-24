import { build } from "esbuild";

// Bundle the API into one self-contained file.
//
// Every workspace package points `main` at `src/index.ts` and has no build
// step — the repo runs from TypeScript source via tsx. That works in dev and
// under vitest, but plain `node` can't resolve a `.js` specifier to a `.ts`
// file, so a plain `tsc` build produced an entrypoint that crashed on its first
// workspace import. Bundling resolves those imports at build time instead.
//
// Only `@brindle/*` is inlined. Real npm dependencies stay external so they
// load from node_modules as usual — bundling them would be slower to build, and
// would break `@prisma/client`, whose generated client and native engine are
// resolved relative to their own package directory.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  // Keep the stack traces readable; this runs on a server, not over the wire.
  minify: false,
  plugins: [
    {
      name: "externalize-node-modules",
      setup(b) {
        // Anything that isn't relative and isn't ours stays external.
        b.onResolve({ filter: /^[^./]|^\.[^./]|^\.\.[^/]/ }, (args) => {
          if (args.path.startsWith("@brindle/")) return null; // bundle ours
          return { path: args.path, external: true };
        });
      },
    },
  ],
  // esbuild emits ESM that may reference these; Node provides them natively.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log("bundled -> apps/api/dist/index.js");
