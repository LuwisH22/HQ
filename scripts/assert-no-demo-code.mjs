/**
 * Fails the build if development demo mode leaked into a production bundle.
 *
 * Demo mode is gated two ways: `import.meta.env.DEV` folds to `false`, and
 * `vite.config.ts` aliases `@/services/demo` to a stub for non-development
 * builds. Both are easy to undo by accident — an import added in the wrong
 * place, an alias reordered — and the failure would be silent. This turns the
 * guarantee into something the build actually checks.
 *
 * Run automatically as part of `npm run verify`, after `vite build`.
 *
 *   node scripts/assert-no-demo-code.mjs [dist]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const distDir = resolve(process.argv[2] ?? 'dist')

/**
 * Strings that only exist in the demo implementation or its seed data. Chosen
 * to be specific enough that a match is unambiguous.
 */
const FORBIDDEN = [
  'Continue as Demo Admin',
  'lfg-hq-demo-db',
  'demo.owner@lfg.test',
  'Riley Vance',
  'signInAsDemoAdmin',
  'resetDemoDatabase',
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

let files
try {
  files = walk(distDir).filter((f) => /\.(js|css|html)$/.test(f))
} catch {
  console.error(`assert-no-demo-code: no build output at ${distDir}. Run the build first.`)
  process.exit(1)
}

if (files.length === 0) {
  console.error(`assert-no-demo-code: no JS/CSS/HTML found in ${distDir}.`)
  process.exit(1)
}

const violations = []
for (const file of files) {
  const contents = readFileSync(file, 'utf8')
  for (const needle of FORBIDDEN) {
    if (contents.includes(needle)) violations.push({ file, needle })
  }
}

if (violations.length > 0) {
  console.error('assert-no-demo-code: demo mode leaked into the production bundle.\n')
  for (const { file, needle } of violations) {
    console.error(`  ${needle}  ->  ${file}`)
  }
  console.error(
    '\nCheck the `resolve.alias` block in vite.config.ts and make sure nothing\n' +
      'imports from @/services/demo outside a dev-only guard.',
  )
  process.exit(1)
}

console.log(
  `assert-no-demo-code: OK — checked ${String(files.length)} bundled files, no demo code present.`,
)
