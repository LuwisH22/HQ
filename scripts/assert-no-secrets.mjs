/**
 * Fails the build if a server-only credential reached the client bundle.
 *
 * Every one of these is a key that mints authority rather than proving it: the
 * Supabase service-role key ignores RLS, and the LiveKit API secret signs a
 * token for any room with any grant. They live in Edge Function secrets, and
 * nothing in `src/` reads them — but "nothing reads them" is a claim about
 * code that changes, and a `VITE_` prefix on the wrong line would ship one
 * silently to every browser that loads the app.
 *
 * Two things are checked, because they fail differently:
 *
 *   1. The built bundle, for the shape of a secret and for the names of the
 *      variables that hold them.
 *   2. `src/`, for a `VITE_` variable whose name sounds like a secret —
 *      caught before it is ever built rather than after.
 *
 * The anon key is deliberately not here. It is public by design and is the
 * one Supabase credential the client is supposed to carry.
 *
 * Run automatically as part of `npm run verify`, after `vite build`.
 *
 *   node scripts/assert-no-secrets.mjs [dist]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const distDir = resolve(process.argv[2] ?? 'dist')

/** Names that only ever belong on a server. */
const FORBIDDEN_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_API_KEY',
  'SUPABASE_DB_PASSWORD',
]

/**
 * Shapes, for the case where a value is pasted in without its name.
 *
 * A service-role key is a JWT whose payload says so; `"role":"service_role"`
 * survives base64 as a recognisable run of characters, but the decoded form is
 * what is actually checked below.
 */
const FORBIDDEN_SHAPES = [
  { label: 'a service-role JWT', re: /"role"\s*:\s*"service_role"/ },
  { label: 'a LiveKit API secret binding', re: /apiSecret\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/ },
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

function decodeJwtPayloads(text) {
  // Anything JWT-shaped, decoded, so a service-role key is caught by what it
  // says rather than by how it looks.
  const out = []
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g)) {
    const [, payload] = match[0].split('.')
    try {
      out.push(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch {
      // Not a JWT after all.
    }
  }
  return out
}

let failures = 0
function fail(message) {
  console.error(`assert-no-secrets: ${message}`)
  failures += 1
}

// --- 1. the built bundle ---------------------------------------------------
let files = []
try {
  files = walk(distDir).filter((f) => /\.(js|mjs|css|html|map)$/.test(f))
} catch {
  fail(`no build found at ${distDir}. Run \`npm run build\` first.`)
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')

  for (const name of FORBIDDEN_NAMES) {
    if (text.includes(name)) fail(`${file} mentions ${name}`)
  }
  for (const { label, re } of FORBIDDEN_SHAPES) {
    if (re.test(text)) fail(`${file} looks like it carries ${label}`)
  }
  for (const payload of decodeJwtPayloads(text)) {
    if (payload.includes('service_role')) fail(`${file} carries a service-role JWT`)
  }
}

// --- 2. the source, before it is ever built --------------------------------
function sourceFiles(dir) {
  return walk(dir).filter((f) => /\.(ts|tsx)$/.test(f))
}

for (const file of sourceFiles(resolve('src'))) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/VITE_[A-Z0-9_]+/g)) {
    const name = match[0]
    if (/SECRET|SERVICE_ROLE|PRIVATE_KEY|PASSWORD/.test(name)) {
      fail(`${file} reads ${name} — a VITE_ variable is public by definition`)
    }
  }
}

console.log(
  failures === 0
    ? `assert-no-secrets: OK — checked ${String(files.length)} bundled files, no server-only credential present.`
    : `assert-no-secrets: FAILED with ${String(failures)} problem(s).`,
)
process.exit(failures === 0 ? 0 : 1)
