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
 * Deliberately narrow, and narrow on the right axis. It only touches names
 * built by `uniqueName`, which carry the Playwright project inside them —
 * `probe-desktop-12345`, `thread-mobile-98168`. Nobody types that.
 *
 * It used to also require the channel to be empty, which sounded careful and
 * was useless: a thread test always leaves a message behind, so its channels
 * could never be swept and accumulated instead. The project name is the real
 * guard.
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
  'unread-',
  'nostub-',
  'nosearch-',
  'search-',
  'pinpanel-',
  'react-',
  'threadsearch-',
  'threadreact-',
  'threaddel-',
  'threadcount-',
  'threadback-',
  'thread-',
  'mentionthread-',
  'mentionsend-',
  'mentionopen-',
  'mentionshut-',
  'mentionkeys-',
  'mentionmail-',
  'mention-',
  'attachthread-',
  'attachdrop-',
  'attachonly-',
  'attachpriv-',
  'attachimg-',
  'attachdoc-',
  'attachno-',
  'attach-',
  'composeract-',
  'composer-',
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
  return (
    PREFIXES.some((prefix) => name.startsWith(prefix)) &&
    /-(desktop|mobile|moderation|signout)-\d+(-alt)?$/.test(name)
  )
}

export default async function globalTeardown(): Promise<void> {
  const env = { ...readEnvFile('.env'), ...readEnvFile('.env.e2e'), ...process.env }
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY

  if (!url || !key || !env.E2E_EMAIL || !env.E2E_PASSWORD) return

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email: env.E2E_EMAIL,
    password: env.E2E_PASSWORD,
  })
  const userId = auth?.user?.id ?? ''
  if (authError) {
    console.warn(`teardown: could not sign in (${authError.message}); leaving anything behind.`)
    return
  }

  const { data } = await supabase.from('channels').select('id, name')
  const channels = (data ?? []) as NamedRow[]
  let removed = 0

  for (const channel of channels) {
    if (!isTestLitter(channel.name)) continue

    const { error } = await supabase.rpc('delete_channel', { p_channel_id: channel.id })
    if (error) console.warn(`teardown: could not delete ${channel.name}: ${error.message}`)
    else removed += 1
  }

  // Direct messages cannot be swept away with their conversation the way a
  // channel test's messages go with the channel: a 1-to-1 is unique per pair
  // and stays. So they carry a marker, and every one of them is removed —
  // delete_message hard-deletes a direct message with no replies under it.
  const { data: dmRows } = await supabase
    .from('messages')
    .select('id, body, conversation_id')
    .not('conversation_id', 'is', null)

  for (const message of (dmRows ?? []) as { id: string; body: string }[]) {
    if (!message.body.includes('e2e-dm')) continue
    const { error } = await supabase.rpc('delete_message', { p_message_id: message.id })
    if (error) console.warn(`teardown: could not delete a direct message: ${error.message}`)
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

  // Files a failed run uploaded but never attached to anything. An object with
  // no attachment row is reachable by nobody but its uploader, which is who
  // this is — and a real attachment always has a row, so this cannot take one.
  const { data: objects } = await supabase.storage.from('message-attachments').list(userId, {
    limit: 1000,
  })
  const orphans: string[] = []

  for (const object of (objects ?? []) as { name: string }[]) {
    const path = `${userId}/${object.name}`
    const { data: linked } = await supabase
      .from('message_attachments')
      .select('id')
      .eq('storage_path', path)
      .maybeSingle()
    if (!linked) orphans.push(path)
  }

  if (orphans.length > 0) {
    const { error } = await supabase.storage.from('message-attachments').remove(orphans)
    if (error) console.warn(`teardown: could not remove orphaned files: ${error.message}`)
    else removed += orphans.length
  }

  if (removed > 0) console.warn(`teardown: swept up ${String(removed)} leftover test objects.`)
}
