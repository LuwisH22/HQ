import { useQuery } from '@tanstack/react-query'
import {
  DownloadSimple,
  FileArchive,
  FilePdf,
  FileText,
  Image as ImageIcon,
} from '@phosphor-icons/react'
import { attachmentService } from '@/services/attachment.service'
import type { MessageAttachment } from '@/services/attachment.service'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { categoryOf, formatBytes, type AttachmentCategory } from './attachments'

/**
 * The files on a message.
 *
 * ONLY AN IMAGE IS EVER DRAWN, and only in an `<img>`. Everything else is a
 * card with a name and a size and a link that downloads — no iframe, no
 * preview of unknown content, and nothing that could render an uploaded file
 * as markup. A file that lies about being an image therefore gains nothing:
 * the `<img>` fails, and the alternative text is its name.
 *
 * The bucket is private, so every URL here is signed and short-lived, and
 * storage will only mint one for an object the caller could select — which its
 * policy defines as an object attached to a message they can read. Nothing on
 * this page decides that; it asks, and gets a URL or does not.
 */

const ICONS: Record<AttachmentCategory, typeof FileText> = {
  image: ImageIcon,
  pdf: FilePdf,
  text: FileText,
  archive: FileArchive,
  other: FileText,
}

function AttachmentCard({
  attachment,
  href,
}: {
  attachment: MessageAttachment
  href: string | undefined
}) {
  const Icon = ICONS[categoryOf(attachment.mimeType)]

  const inner = (
    <>
      <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight font-medium">
          {attachment.fileName}
        </span>
        <span className="text-2xs text-muted-foreground block font-mono">
          {formatBytes(attachment.byteSize)}
        </span>
      </span>
      <DownloadSimple className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
    </>
  )

  const className = cn(
    'border-border-subtle bg-elevated flex h-10 w-full max-w-sm items-center gap-2.5 rounded-md border px-2.5',
    'transition-colors duration-[120ms]',
    href
      ? 'hover:bg-elevated focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none'
      : 'opacity-60',
  )

  if (!href) {
    // No URL means storage would not sign one, which means this file is not
    // this reader's to open. Saying so is better than a link that fails.
    return (
      <div className={className} aria-label={`${attachment.fileName}, unavailable`}>
        {inner}
      </div>
    )
  }

  return (
    <a
      href={href}
      // The signed URL already carries a Content-Disposition, so this is a
      // download whatever the file turns out to contain.
      download={attachment.fileName}
      rel="noreferrer"
      className={className}
      aria-label={`Download ${attachment.fileName}, ${formatBytes(attachment.byteSize)}`}
    >
      {inner}
    </a>
  )
}

export function MessageAttachments({ attachments }: { attachments: readonly MessageAttachment[] }) {
  const paths = attachments.map((a) => a.storagePath)

  // Two batches: images are shown, so they need a plain URL; everything else
  // is downloaded, so it needs the disposition. Both are refused for an object
  // the caller cannot read.
  const previews = useQuery({
    queryKey: queryKeys.attachments.urls(paths, 'inline'),
    queryFn: () =>
      attachmentService.signedUrls(
        attachments.filter((a) => categoryOf(a.mimeType) === 'image').map((a) => a.storagePath),
      ),
    enabled: attachments.some((a) => categoryOf(a.mimeType) === 'image'),
    staleTime: 30 * 60_000,
  })

  const downloads = useQuery({
    queryKey: queryKeys.attachments.urls(paths, 'download'),
    queryFn: () => attachmentService.signedUrls(paths, { download: true }),
    enabled: paths.length > 0,
    staleTime: 30 * 60_000,
  })

  if (attachments.length === 0) return null

  return (
    <ul className="mt-1.5 space-y-1.5" aria-label="Attachments">
      {attachments.map((attachment) => {
        const isImage = categoryOf(attachment.mimeType) === 'image'
        const preview = previews.data?.get(attachment.storagePath)
        const download = downloads.data?.get(attachment.storagePath)

        return (
          <li key={attachment.id}>
            {isImage && preview ? (
              <a
                href={download ?? preview}
                download={attachment.fileName}
                rel="noreferrer"
                className="focus-visible:ring-ring inline-block rounded-md focus-visible:ring-2 focus-visible:outline-none"
                aria-label={`Download ${attachment.fileName}, ${formatBytes(attachment.byteSize)}`}
              >
                {/* Bounded in both directions so a tall or wide image cannot
                    push the conversation around. */}
                <img
                  src={preview}
                  alt={attachment.fileName}
                  loading="lazy"
                  className="border-border-subtle max-h-80 w-auto max-w-[min(400px,100%)] rounded-md border object-contain"
                />
              </a>
            ) : (
              <AttachmentCard attachment={attachment} href={download} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
