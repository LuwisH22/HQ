import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoAttachmentService } from '@/services/demo'
import { attachmentPath, uploadTypeOf } from '@/features/channels/attachments'
import type { AttachmentService, MessageAttachment, UploadedAttachment } from './service-contracts'

export type { MessageAttachment, UploadedAttachment } from './service-contracts'

/**
 * Files on messages.
 *
 * The bucket is private and there is no service-role key anywhere near this
 * file. Every read is a signed URL, and storage will only mint one for an
 * object the caller could have selected — which its policy defines as an
 * object attached to a message they can read, or one they uploaded themselves.
 * So "can this person see this file" is answered by the same rule that answers
 * "can this person see this message", one implementation, in the database.
 *
 * Writing is two steps on purpose. The bytes go up while the composer is still
 * open, under `{uploader_id}/{uuid}` — the only prefix the storage policy will
 * accept from this caller — and the metadata row is written after the message
 * exists. Between those two moments the object belongs to nobody but its
 * uploader, and it is exactly that gap the discard path below cleans up.
 */

const BUCKET = 'message-attachments'

/** How long a signed URL lives. Long enough to open, short enough to forget. */
const SIGNED_URL_TTL_SECONDS = 60 * 60

interface AttachmentRow {
  id: string
  message_id: string
  storage_path: string
  file_name: string
  mime_type: string
  byte_size: number
  created_at: string
}

function toAttachment(row: AttachmentRow): MessageAttachment {
  return {
    id: row.id,
    messageId: row.message_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  }
}

export const supabaseAttachmentService: AttachmentService = {
  async upload(file: File): Promise<UploadedAttachment> {
    const supabase = getSupabase()

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) throw new AppError('auth', 'Your session has expired. Please sign in again.')

    // The path is the caller's own id and a fresh uuid. The storage policy
    // accepts no other prefix from them, and a uuid that has never existed
    // cannot collide with anybody's object.
    const path = attachmentPath(userId)

    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: uploadTypeOf(file),
      // Never overwrite. There is no UPDATE policy on the bucket either, so
      // this is belt and braces on a path that cannot repeat anyway.
      upsert: false,
    })

    if (error) throw toAppError(error)

    return {
      storagePath: path,
      fileName: file.name,
      // Recorded for the optimistic view only. The database reads both back
      // out of storage when the row is written.
      mimeType: uploadTypeOf(file),
      byteSize: file.size,
    }
  },

  async attach(messageId: string, uploads: readonly UploadedAttachment[]): Promise<void> {
    if (uploads.length === 0) return

    const { error } = await getSupabase()
      .from('message_attachments')
      .insert(
        uploads.map((upload) => ({
          message_id: messageId,
          storage_path: upload.storagePath,
          file_name: upload.fileName,
        })),
      )

    if (error) throw toAppError(error)
  },

  async listFor(messageIds: readonly string[]): Promise<Map<string, MessageAttachment[]>> {
    const byMessage = new Map<string, MessageAttachment[]>()
    if (messageIds.length === 0) return byMessage

    // Rows arrive already scoped: an attachment on a message the caller cannot
    // read is not in the response.
    const { data, error } = await getSupabase()
      .from('message_attachments')
      .select('id, message_id, storage_path, file_name, mime_type, byte_size, created_at')
      .in('message_id', [...messageIds])
      .order('created_at', { ascending: true })

    if (error) throw toAppError(error)

    for (const row of (data ?? []) as AttachmentRow[]) {
      const list = byMessage.get(row.message_id) ?? []
      list.push(toAttachment(row))
      byMessage.set(row.message_id, list)
    }

    return byMessage
  },

  async signedUrls(
    paths: readonly string[],
    options: { download?: boolean } = {},
  ): Promise<Map<string, string>> {
    const urls = new Map<string, string>()
    if (paths.length === 0) return urls

    const { data, error } = await getSupabase()
      .storage.from(BUCKET)
      .createSignedUrls([...paths], SIGNED_URL_TTL_SECONDS, {
        download: options.download ?? false,
      })

    // A path the caller cannot read yields no URL rather than an error for the
    // whole batch, so one inaccessible file does not blank a page of messages.
    if (error) throw toAppError(error)

    for (const row of data ?? []) {
      if (row.error !== null || !row.signedUrl) continue
      urls.set(row.path ?? '', row.signedUrl)
    }

    return urls
  },

  async discard(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return
    // Best effort, and only ever the caller's own objects: the delete policy
    // admits nothing outside their prefix. A failure here costs a stray file,
    // never a broken send.
    await getSupabase()
      .storage.from(BUCKET)
      .remove([...paths])
  },
}

function impl(): AttachmentService {
  return isDemoSessionActive() ? demoAttachmentService : supabaseAttachmentService
}

export const attachmentService: AttachmentService = {
  upload: (file) => impl().upload(file),
  attach: (messageId, uploads) => impl().attach(messageId, uploads),
  listFor: (messageIds) => impl().listFor(messageIds),
  signedUrls: (paths, options) => impl().signedUrls(paths, options),
  discard: (paths) => impl().discard(paths),
}
