import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PermissionSet } from '@/lib/permissions'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/organization/workspace-context'
import { Can } from './Can'

function renderWithPermissions(permissions: string[], ui: React.ReactNode) {
  const value: WorkspaceContextValue = {
    status: 'ready',
    organization: null,
    organizations: [],
    membership: null,
    permissions: new PermissionSet(permissions),
    error: null,
    selectOrganization: () => undefined,
    refresh: () => Promise.resolve(),
  }

  return render(<WorkspaceContext.Provider value={value}>{ui}</WorkspaceContext.Provider>)
}

describe('Can', () => {
  it('renders children when the permission is held', () => {
    renderWithPermissions(['members.invite'], <Can perm="members.invite">Invite</Can>)
    expect(screen.getByText('Invite')).toBeInTheDocument()
  })

  it('renders nothing when the permission is missing', () => {
    renderWithPermissions([], <Can perm="members.invite">Invite</Can>)
    expect(screen.queryByText('Invite')).not.toBeInTheDocument()
  })

  it('renders the fallback when the check fails', () => {
    renderWithPermissions(
      [],
      <Can perm="members.invite" fallback={<span>Ask an admin</span>}>
        Invite
      </Can>,
    )
    expect(screen.getByText('Ask an admin')).toBeInTheDocument()
    expect(screen.queryByText('Invite')).not.toBeInTheDocument()
  })

  it('supports any-of checks', () => {
    renderWithPermissions(['files.view'], <Can any={['files.upload', 'files.view']}>Files</Can>)
    expect(screen.getByText('Files')).toBeInTheDocument()
  })

  it('supports all-of checks', () => {
    renderWithPermissions(['tasks.view'], <Can all={['tasks.view', 'tasks.assign']}>Assign</Can>)
    expect(screen.queryByText('Assign')).not.toBeInTheDocument()
  })

  it('requires every supplied check to pass together', () => {
    renderWithPermissions(
      ['members.view'],
      <Can perm="members.view" all={['members.remove']}>
        Remove
      </Can>,
    )
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
  })
})
