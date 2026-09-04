/**
 * Database types for the Phase 1 schema.
 *
 * Hand-maintained to match `supabase/migrations`. Regenerate against a live
 * project with:
 *
 *   npx supabase gen types typescript --local > src/types/database.types.ts
 *   # or, for a hosted project:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type MemberStatus = 'active' | 'suspended'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          slug: string
          name: string
          tagline: string | null
          logo_url: string | null
          timezone: string
          /** Sole source of truth for ownership. Never derived from a role. */
          owner_id: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          slug: string
          name: string
          tagline?: string | null
          logo_url?: string | null
          timezone?: string
        }
        Update: {
          name?: string
          tagline?: string | null
          logo_url?: string | null
          timezone?: string
          deleted_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          display_name: string | null
          avatar_url: string | null
          title: string | null
          bio: string | null
          timezone: string
          last_seen_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          display_name?: string | null
          avatar_url?: string | null
          title?: string | null
          bio?: string | null
          timezone?: string
        }
        Update: {
          full_name?: string | null
          display_name?: string | null
          avatar_url?: string | null
          title?: string | null
          bio?: string | null
          timezone?: string
          last_seen_at?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          key: string
          category: string
          label: string
          description: string | null
          sort_order: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      role_templates: {
        Row: { key: string; name: string; description: string; rank: number }
        Insert: never
        Update: never
        Relationships: []
      }
      role_template_permissions: {
        Row: { role_template_key: string; permission_key: string }
        Insert: never
        Update: never
        Relationships: []
      }
      roles: {
        Row: {
          id: string
          organization_id: string
          key: string
          name: string
          description: string | null
          rank: number
          is_system: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          key: string
          name: string
          description?: string | null
          rank: number
          is_system?: boolean
        }
        Update: {
          name?: string
          description?: string | null
          rank?: number
        }
        Relationships: [
          {
            foreignKeyName: 'roles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      role_permissions: {
        Row: { role_id: string; permission_key: string; created_at: string }
        Insert: { role_id: string; permission_key: string }
        Update: never
        Relationships: [
          {
            foreignKeyName: 'role_permissions_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'role_permissions_permission_key_fkey'
            columns: ['permission_key']
            isOneToOne: false
            referencedRelation: 'permissions'
            referencedColumns: ['key']
          },
        ]
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role_id: string
          status: MemberStatus
          joined_at: string
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: {
          role_id?: string
          status?: MemberStatus
        }
        Relationships: [
          {
            foreignKeyName: 'organization_members_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organization_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'organization_members_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      invitations: {
        Row: {
          id: string
          organization_id: string
          email: string
          role_id: string
          invited_by: string | null
          token_hash: string
          status: InvitationStatus
          expires_at: string
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'invitations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invitations_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invitations_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invitations_accepted_by_fkey'
            columns: ['accepted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          id: number
          organization_id: string | null
          actor_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          summary: string | null
          metadata: Json
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'audit_logs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_logs_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      member_roles: {
        Row: {
          member_id: string
          role_id: string
          assigned_by: string | null
          assigned_at: string
        }
        Insert: {
          member_id: string
          role_id: string
          assigned_by?: string | null
          assigned_at?: string
        }
        Update: {
          member_id?: string
          role_id?: string
          assigned_by?: string | null
          assigned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'member_roles_member_id_fkey'
            columns: ['member_id']
            isOneToOne: false
            referencedRelation: 'organization_members'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'member_roles_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'member_roles_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<never, never>
    Functions: {
      is_org_member: { Args: { p_organization_id: string }; Returns: boolean }
      has_org_permission: {
        Args: { p_organization_id: string; p_permission: string }
        Returns: boolean
      }
      my_role_rank: { Args: { p_organization_id: string }; Returns: number }
      shares_organization_with: { Args: { p_user_id: string }; Returns: boolean }
      my_permissions: { Args: { p_organization_id: string }; Returns: string[] }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined }
      create_invitation: {
        Args: {
          p_organization_id: string
          p_email: string
          p_role_id: string
          p_token: string
          p_expires_in_days?: number
        }
        Returns: Database['public']['Tables']['invitations']['Row']
      }
      is_org_owner: { Args: { p_organization_id: string }; Returns: boolean }
      create_role: {
        Args: {
          p_organization_id: string
          p_name: string
          p_description?: string | null
          p_rank?: number
        }
        Returns: string
      }
      update_role: {
        Args: { p_role_id: string; p_name: string; p_description?: string | null }
        Returns: undefined
      }
      set_role_rank: { Args: { p_role_id: string; p_rank: number }; Returns: undefined }
      delete_role: { Args: { p_role_id: string }; Returns: undefined }
      set_role_permissions: {
        Args: { p_role_id: string; p_permission_keys: string[] }
        Returns: undefined
      }
      assign_role_to_member: {
        Args: { p_member_id: string; p_role_id: string }
        Returns: undefined
      }
      unassign_role_from_member: {
        Args: { p_member_id: string; p_role_id: string }
        Returns: undefined
      }
    }
    Enums: {
      member_status: MemberStatus
      invitation_status: InvitationStatus
    }
    CompositeTypes: Record<never, never>
  }
}

// --- Convenience aliases ---------------------------------------------------

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update']

export type OrganizationRow = Tables<'organizations'>
export type ProfileRow = Tables<'profiles'>
export type RoleRow = Tables<'roles'>
export type PermissionRow = Tables<'permissions'>
export type OrganizationMemberRow = Tables<'organization_members'>
export type InvitationRow = Tables<'invitations'>
export type AuditLogRow = Tables<'audit_logs'>
export type MemberRoleRow = Tables<'member_roles'>
