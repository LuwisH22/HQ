import { lazy } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth/RequireAuth'
import { SignInPage } from '@/features/auth/SignInPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { NotFoundPage } from '@/features/placeholder/NotFoundPage'

/**
 * Routing.
 *
 * A hash router is used deliberately. Tauri serves the built app from a custom
 * protocol and the PWA is a static deployment; hash routes need no server-side
 * rewrite in either case, so deep links behave identically on desktop and web.
 *
 * The dashboard and auth screens are eager — they are on the critical path.
 * Everything else is split, keeping the initial desktop bundle small.
 */

const MembersPage = lazy(() =>
  import('@/features/members/MembersPage').then((m) => ({ default: m.MembersPage })),
)
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const SettingsIndex = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsIndex })),
)
const OrganizationSettings = lazy(() =>
  import('@/features/settings/OrganizationSettings').then((m) => ({
    default: m.OrganizationSettings,
  })),
)
const RolesSettings = lazy(() =>
  import('@/features/settings/RolesSettings').then((m) => ({ default: m.RolesSettings })),
)

const ChannelsSettings = lazy(() =>
  import('@/features/settings/ChannelsSettings').then((m) => ({ default: m.ChannelsSettings })),
)

const MessagesPage = lazy(() =>
  import('@/features/placeholder/pages').then((m) => ({ default: m.MessagesPage })),
)
const ChannelsPage = lazy(() =>
  import('@/features/channels/ChannelsPage').then((m) => ({ default: m.ChannelsPage })),
)

// One address, two kinds of room: the channel's type decides which surface
// opens, not the URL.
const ChannelRoute = lazy(() =>
  import('@/features/channels/ChannelRoute').then((m) => ({ default: m.ChannelRoute })),
)
const ConversationChatPage = lazy(() =>
  import('@/features/channels/ConversationChatPage').then((m) => ({
    default: m.ConversationChatPage,
  })),
)
const ProjectsPage = lazy(() =>
  import('@/features/placeholder/pages').then((m) => ({ default: m.ProjectsPage })),
)
const CalendarPage = lazy(() =>
  import('@/features/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })),
)
const TeamsPage = lazy(() =>
  import('@/features/placeholder/pages').then((m) => ({ default: m.TeamsPage })),
)
const FilesPage = lazy(() =>
  import('@/features/placeholder/pages').then((m) => ({ default: m.FilesPage })),
)
const NotificationsPage = lazy(() =>
  import('@/features/placeholder/pages').then((m) => ({ default: m.NotificationsPage })),
)

export const router = createHashRouter([
  {
    // Redeeming an invitation requires a session, so it sits outside the
    // "redirect away if signed in" guard that wraps the other auth screens.
    path: '/auth/accept-invite',
    element: <AcceptInvitePage />,
  },
  {
    // Supabase sends recovery links here with a session already established.
    path: '/auth/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/auth',
    element: <RedirectIfAuthenticated />,
    children: [
      { index: true, element: <Navigate to="/auth/sign-in" replace /> },
      { path: 'sign-in', element: <SignInPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      // Magic-link and invite emails land here; Supabase has already exchanged
      // the code by the time this renders, so bounce into the app.
      { path: 'callback', element: <Navigate to="/" replace /> },
    ],
  },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'messages', element: <MessagesPage /> },
          { path: 'channels', element: <ChannelsPage /> },
          { path: 'channels/:channelKey', element: <ChannelRoute /> },
          // Its own route, beside the channels rather than under them: a
          // conversation is not a channel and its id is not a channel key.
          { path: 'dm/:conversationId', element: <ConversationChatPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'teams', element: <TeamsPage /> },
          { path: 'files', element: <FilesPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'members', element: <MembersPage /> },
          {
            path: 'settings',
            element: <SettingsPage />,
            children: [
              { index: true, element: <SettingsIndex /> },
              // The profile lived here until it moved to the sidebar. Kept as
              // a redirect so an old link lands on Settings rather than on a
              // not-found page; the index below then picks the first section
              // this member may actually open.
              { path: 'profile', element: <Navigate to="/settings" replace /> },
              { path: 'organization', element: <OrganizationSettings /> },
              { path: 'roles', element: <RolesSettings /> },
              { path: 'channels', element: <ChannelsSettings /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
