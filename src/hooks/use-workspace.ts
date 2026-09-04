import { useContext } from 'react'
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/features/organization/workspace-context'

/** Active organization, membership and permissions. */
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  }
  return context
}
