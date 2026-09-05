import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  attachmentPath,
  categoryOf,
  formatBytes,
  rejectAttachment,
  uploadTypeOf,
} from './attachments'

/**
 * What may be attached, and how it is described.
 *
 * None of this is the boundary — the bucket refuses an oversized or wrongly
 * typed upload before a byte is written, and the database reads the real size
 * and type back out of storage. It is the courtesy that saves somebody a
 * failed upload, and the reason a file is offered as a download rather than
 * drawn, and both of those are worth being exactly right about.
 */

const file = (name: string, type: string, size = 10) => ({ name, type, size })

describe('what may be attached', () => {
  it('accepts the four categories the product supports', () => {
    for (const [name, type] of [
      ['shot.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['clip.gif', 'image/gif'],
      ['art.webp', 'image/webp'],
      ['contract.pdf', 'application/pdf'],
      ['notes.txt', 'text/plain'],
      ['vods.zip', 'application/zip'],
    ]) {
      expect(rejectAttachment(file(name!, type!))).toBeNull()
    }
  })

  it('refuses anything that could be executed', () => {
    for (const [name, type] of [
      ['run.sh', 'application/x-sh'],
      ['setup.exe', 'application/x-msdownload'],
      ['page.html', 'text/html'],
      ['app.js', 'text/javascript'],
      ['macro.svg', 'image/svg+xml'],
    ]) {
      // SVG is an image and is still refused: it is markup a browser will run.
      expect(rejectAttachment(file(name!, type!))?.reason).toBe('type')
    }
  })

  it('names the file it is refusing', () => {
    expect(rejectAttachment(file('run.sh', 'application/x-sh'))?.message).toContain('run.sh')
  })

  it('refuses a file over 25 MB, and takes one exactly at the limit', () => {
    expect(rejectAttachment(file('big.zip', 'application/zip', MAX_ATTACHMENT_BYTES))).toBeNull()
    const over = rejectAttachment(file('big.zip', 'application/zip', MAX_ATTACHMENT_BYTES + 1))
    expect(over?.reason).toBe('size')
    expect(over?.message).toContain('25 MB')
  })

  it('refuses an empty file', () => {
    expect(rejectAttachment(file('nothing.txt', 'text/plain', 0))?.reason).toBe('size')
  })

  it('reads the extension when the browser offers no type', () => {
    // Windows in particular sends '' for .zip and .txt often enough to matter.
    expect(rejectAttachment(file('vods.zip', ''))).toBeNull()
    expect(rejectAttachment(file('notes.txt', ''))).toBeNull()
    expect(rejectAttachment(file('contract.pdf', ''))).toBeNull()
    expect(rejectAttachment(file('run.sh', ''))?.reason).toBe('type')
  })

  it('uploads with the type the extension implies, never nothing', () => {
    expect(uploadTypeOf(file('vods.zip', ''))).toBe('application/zip')
    expect(uploadTypeOf(file('shot.png', 'image/png'))).toBe('image/png')
    expect(uploadTypeOf(file('mystery', ''))).toBe('application/octet-stream')
  })

  it('offers the allowed types to the file picker', () => {
    expect(ATTACHMENT_ACCEPT).toContain('image/png')
    expect(ATTACHMENT_ACCEPT).toContain('application/pdf')
    expect(ATTACHMENT_ACCEPT).not.toContain('text/html')
  })
})

describe('how a file will be offered', () => {
  it('draws an image and downloads everything else', () => {
    expect(categoryOf('image/png')).toBe('image')
    expect(categoryOf('image/webp')).toBe('image')
    expect(categoryOf('application/pdf')).toBe('pdf')
    expect(categoryOf('text/plain')).toBe('text')
    expect(categoryOf('application/zip')).toBe('archive')
    expect(categoryOf('application/x-zip-compressed')).toBe('archive')
  })

  it('treats anything it does not recognise as a plain file', () => {
    // Storage decides the type, so a row can hold something this build has
    // never heard of. It becomes a download, which is the safe answer.
    expect(categoryOf('application/octet-stream')).toBe('other')
    expect(categoryOf('text/html')).toBe('other')
  })
})

describe('describing a size', () => {
  it('reads the way a person would', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(1_500_000)).toBe('1.4 MB')
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe('25 MB')
  })

  it('drops the decimal once it stops being useful', () => {
    expect(formatBytes(14_300_000)).toBe('14 MB')
  })
})

describe('where a file goes', () => {
  it('is the uploader and a fresh id, which is the only prefix storage takes', () => {
    const me = '0ae0c265-6725-4626-a4eb-23972b59ad24'
    const path = attachmentPath(me)

    expect(path.split('/')[0]).toBe(me)
    expect(path.split('/')).toHaveLength(2)
    // Two calls never collide, so an upload can never overwrite another.
    expect(attachmentPath(me)).not.toBe(path)
  })
})
