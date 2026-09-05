/**
 * What may be attached, and how it is described.
 *
 * Pure, and separate from anything that uploads: what counts as an allowed
 * file is a rule worth stating once and testing without a network.
 *
 * NONE OF THIS IS A SECURITY BOUNDARY, deliberately. The bucket refuses an
 * oversized or wrongly typed upload before a byte is written, and the database
 * reads the real size and content type back out of storage rather than
 * believing the client. Everything here is the courtesy that saves somebody a
 * failed upload and tells them why — and the reason a file is offered as a
 * download rather than drawn.
 */

/** 25 MB, matching the bucket's own limit. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * The categories the product supports, and the exact content types behind
 * each. Nothing executable, and nothing that a browser would render as markup.
 */
export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
] as const

/** What a file picker should offer. */
export const ATTACHMENT_ACCEPT = [...ALLOWED_MIME_TYPES, '.zip', '.txt', '.pdf'].join(',')

export type AttachmentCategory = 'image' | 'pdf' | 'text' | 'archive' | 'other'

/**
 * How a file will be offered to the reader.
 *
 * Only `image` is ever drawn, and only in an `<img>`. Everything else is a
 * download and nothing else, so a file that lies about its type gains nothing
 * — an `<img>` that is handed a shell script simply fails to render.
 */
export function categoryOf(mimeType: string): AttachmentCategory {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'text/plain') return 'text'
  if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
    return 'archive'
  }
  return 'other'
}

/** Some browsers send an empty type for .zip and .txt; the extension decides. */
function declaredType(file: { name: string; type: string }): string {
  if (file.type !== '') return file.type
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) return 'application/zip'
  if (name.endsWith('.txt')) return 'text/plain'
  if (name.endsWith('.pdf')) return 'application/pdf'
  return ''
}

export interface AttachmentRejection {
  reason: 'size' | 'type'
  message: string
}

/** Null when the file may be uploaded; otherwise why it may not. */
export function rejectAttachment(file: {
  name: string
  type: string
  size: number
}): AttachmentRejection | null {
  const type = declaredType(file)

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(type)) {
    return {
      reason: 'type',
      message: `${file.name} is not a kind of file that can be attached. Images, PDF, plain text and ZIP can.`,
    }
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      reason: 'size',
      message: `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(
        MAX_ATTACHMENT_BYTES,
      )}.`,
    }
  }

  if (file.size === 0) {
    return { reason: 'size', message: `${file.name} is empty.` }
  }

  return null
}

/** The content type to upload with, once the extension has had its say. */
export function uploadTypeOf(file: { name: string; type: string }): string {
  return declaredType(file) || 'application/octet-stream'
}

/** Sizes as a person reads them: 900 B, 1.4 MB, 25 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(Math.max(bytes, 0))} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${String(Math.round(kb))} KB`
  const mb = kb / 1024
  // One decimal below ten megabytes, none above: "1.4 MB" is useful, "14.3 MB"
  // is noise.
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${String(Math.round(mb))} MB`
}

/** The object name for a file this user is uploading: `{uploader}/{uuid}`. */
export function attachmentPath(uploaderId: string): string {
  return `${uploaderId}/${crypto.randomUUID()}`
}
