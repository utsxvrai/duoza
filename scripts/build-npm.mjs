// Assembles the publishable `duoza` npm package in release/npm:
//   bin/duoza.mjs                 bundled CLI + launcher (`npx duoza`)
//   marketplace/                  a Claude Code marketplace containing the plugin
//   README.md, SECURITY.md, LICENSE
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { build } from "esbuild"
import { buildPlugin, shared, version } from "./build-plugin.mjs"

const OUT = "release/npm"

await buildPlugin()

if (existsSync(OUT)) renameSync(OUT, `${OUT}.previous-${Date.now()}`)
mkdirSync(`${OUT}/bin`, { recursive: true })
mkdirSync(`${OUT}/marketplace/.claude-plugin`, { recursive: true })

await build({ ...shared, entryPoints: ["packages/client/src/cli.ts"], outfile: `${OUT}/bin/duoza.mjs` })
chmodSync(`${OUT}/bin/duoza.mjs`, 0o755)

cpSync(".claude-plugin/marketplace.json", `${OUT}/marketplace/.claude-plugin/marketplace.json`)
cpSync("plugin", `${OUT}/marketplace/plugin`, { recursive: true })
for (const f of ["README.md", "SECURITY.md", "LICENSE"]) cpSync(f, `${OUT}/${f}`)

const root = JSON.parse(readFileSync("package.json", "utf8"))
const pkg = {
  name: "duoza",
  version,
  description:
    "Connect your Claude Code session with other people's, across Claude accounts and machines: pair with a code, chat, send requests they accept before they run, and hand off context.",
  keywords: ["claude", "claude-code", "plugin", "mcp", "channels", "pair-programming", "collaboration"],
  license: "MIT",
  author: "Utsav Rai",
  homepage: root.homepage,
  repository: root.repository,
  type: "module",
  bin: { duoza: "bin/duoza.mjs" },
  files: ["bin", "marketplace", "README.md", "SECURITY.md", "LICENSE"],
  engines: { node: ">=20" },
}
writeFileSync(`${OUT}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`assembled ${OUT} (duoza@${version})`)
