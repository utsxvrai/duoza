// Bundles the CLI and the channel server into self-contained files inside plugin/dist,
// so the plugin needs no node_modules. Also stamps the version into plugin.json.
import { readFileSync, writeFileSync } from "node:fs"
import { build } from "esbuild"

export const version = JSON.parse(readFileSync("package.json", "utf8")).version

export const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // CommonJS deps (ws, tweetnacl) call require() for node builtins.
  banner: { js: 'import { createRequire as __duozaCreateRequire } from "node:module"; const require = __duozaCreateRequire(import.meta.url);' },
  // Optional native speedups for ws; it falls back to JS when they're missing.
  external: ["bufferutil", "utf-8-validate"],
  define: { "process.env.DUOZA_BUILD_VERSION": JSON.stringify(version) },
  legalComments: "none",
  logLevel: "warning",
}

export async function buildPlugin() {
  await build({ ...shared, entryPoints: ["packages/client/src/cli.ts"], outfile: "plugin/dist/cli.mjs" })
  await build({ ...shared, entryPoints: ["packages/client/src/channel-main.ts"], outfile: "plugin/dist/channel.mjs" })
  const manifestPath = "plugin/.claude-plugin/plugin.json"
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (manifest.version !== version) {
    manifest.version = version
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  console.log(`built plugin ${version}: plugin/dist/cli.mjs, plugin/dist/channel.mjs`)
}

if (import.meta.url === `file://${process.argv[1]}`) await buildPlugin()
