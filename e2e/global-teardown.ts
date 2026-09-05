import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

/**
 * Sweep up anything the suite created and did not get to delete.
 *
 * The signed-in specs run against the live project, and a test that fails
 * halfway leaves its channel behind — which then shows up in the real
 * organization's sidebar. Each spec still deletes its own; this is the net
 * underneath, so a red run costs a red run and not a cluttered workspace.
 *
 * Deliberately narrow. It only touches names built by `uniqueName`, and only
 * when the channel holds no messages: a channel somebody has spoken in is not
 * test litter, whatever it is called.
 */

const PREFIXES = [
  'probe-',
  'secret-',
  'perms-',
  'inside-',
  'alongside-',
  'chat-',
  'reuse-',
  'section-',
]

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}

/** Untyped client, so the shape of a row has to be stated rather than inferred. */
interface NamedRow {
  id: string
  name: string
}

/** Only names this suite generates: `<prefix>-<project>-<digits>`. */
function isTestLitter(name: string): boolean {
  return PREFIXES.some((prefix) => name.startsWith(prefix)) && /-\d+(-alt)?$/.test(name)
}

export default async function globalTeardown(): Promise<void> {
  const env = { ...readEnvFile('.env'), ...readEnvFile('.env.e2e'), ...process.env }
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY

  if (!url || !key || !env.E2E_EMAIL || !env.E2E_PASSWORD) return

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: env.E2E_EMAIL,
    password: env.E2E_PASSWORD,
  })
  if (authError) {
    console.warn(`teardown: could not sign in (${authError.message}); leaving anything behind.`)
    return
  }

  const { data } = await supabase.from('channels').select('id, name')
  const channels = (data ?? []) as NamedRow[]
  let removed = 0

  for (const channel of channels) {
    if (!isTestLitter(channel.name)) continue

    const { data: messages } = await supabase
      .from('messages')
      .select('id')
      .eq('channel_id', channel.id)
    if ((messages ?? []).length > 0) {
      console.warn(`teardown: leaving ${channel.name} alone — it has messages in it.`)
      continue
    }

    const { error } = await supabase.rpc('delete_channel', { p_channel_id: channel.id })
    if (error) console.warn(`teardown: could not delete ${channel.name}: ${error.message}`)
    else removed += 1
  }

  const { data: categoryRows } = await supabase.from('channel_categories').select('id, name')
  for (const category of (categoryRows ?? []) as NamedRow[]) {
    if (!isTestLitter(category.name)) continue
    const { error } = await supabase.rpc('delete_category', { p_category_id: category.id })
    if (error)
      console.warn(`teardown: could not delete category ${category.name}: ${error.message}`)
    else removed += 1
  }

  if (removed > 0) console.warn(`teardown: swept up ${String(removed)} leftover test objects.`)
}
