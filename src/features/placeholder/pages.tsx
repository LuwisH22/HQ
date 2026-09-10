import {
  Bell,
  CalendarBlank,
  Files,
  Hash,
  ChatTeardropText,
} from '@phosphor-icons/react'
import { PhasePlaceholderPage } from './PhasePlaceholderPage'

/**
 * One export per not-yet-built section, so the router stays declarative and
 * each page can be replaced by its real implementation with a single import
 * change.
 */

export function MessagesPage() {
  return (
    <PhasePlaceholderPage
      title="Messages"
      icon={ChatTeardropText}
      phase={2}
      summary="Direct messages and group conversations with the rest of the organization."
      capabilities={[
        'One-to-one and group direct messages',
        'Realtime delivery with optimistic send',
        'Unread counts, read state and typing indicators',
        'Attachments, replies and reactions',
        'Message search across your conversations',
      ]}
    />
  )
}

export function ChannelsPage() {
  return (
    <PhasePlaceholderPage
      title="Channels"
      icon={Hash}
      phase={2}
      summary="Public and private channels for teams, staff and the whole organization."
      capabilities={[
        'Public and private channels with per-channel membership',
        'Threads, pins, mentions and reactions',
        'Virtualised message history with paging',
        'Presence and per-channel unread state',
      ]}
    />
  )
}

export function CalendarPage() {
  return (
    <PhasePlaceholderPage
      title="Calendar"
      icon={CalendarBlank}
      phase={4}
      summary="Scrims, matches, training blocks, meetings and deadlines in one schedule."
      capabilities={[
        'Month, week, day and agenda views',
        'Scrim, match, training, meeting and deadline event types',
        'Participants, related team and related project',
        'Project deadlines surfaced alongside events',
      ]}
    />
  )
}

export function FilesPage() {
  return (
    <PhasePlaceholderPage
      title="Files"
      icon={Files}
      phase={5}
      summary="Private organization storage for VODs, contracts, graphics and documents."
      capabilities={[
        'Folders scoped to the organization, teams, projects and channels',
        'Upload, download, preview, rename, move and delete',
        'Signed URLs — the storage bucket is never public',
        'Per-folder permissions and file metadata search',
      ]}
    />
  )
}

export function NotificationsPage() {
  return (
    <PhasePlaceholderPage
      title="Notifications"
      icon={Bell}
      phase={6}
      summary="One place for mentions, assignments, deadlines and organization updates."
      capabilities={[
        'In-app notification centre with unread counts',
        'Per-category notification preferences',
        'Native desktop notifications through Tauri',
        'Web push for the installed mobile app',
      ]}
    />
  )
}
