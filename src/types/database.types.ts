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

export type MemberStatus = 'active' | 'suspended' | 'banned'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'
/** A channel override either allows or denies. An absent row means inherit. */
export type OverrideEffect = 'allow' | 'deny'
/** A channel is a room for words or a room for voices. */
export type ChannelType = 'text' | 'voice'
/**
 * What kind of thing is in the diary.
 *
 * A category and nothing else: no policy, routine or client check reads it to
 * decide what anybody may do.
 */
export type CalendarEventType =
  'match' | 'scrim' | 'practice' | 'meeting' | 'content' | 'event' | 'other'

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
          /** NULL with status=suspended means indefinite. Never set while banned. */
          suspended_until: string | null
          moderation_reason: string | null
          moderated_by: string | null
          moderated_at: string | null
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
      moderation_actions: {
        Row: {
          id: number
          organization_id: string
          target_member_id: string | null
          target_user_id: string
          actor_id: string | null
          action: string
          reason: string | null
          expires_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'moderation_actions_target_user_id_fkey'
            columns: ['target_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'moderation_actions_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      channel_categories: {
        Row: {
          id: string
          organization_id: string
          name: string
          position: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      channels: {
        Row: {
          id: string
          organization_id: string
          category_id: string | null
          key: string
          name: string
          topic: string | null
          type: ChannelType
          position: number
          is_private: boolean
          archived_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'channels_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'channel_categories'
            referencedColumns: ['id']
          },
        ]
      }
      calendar_events: {
        Row: {
          id: string
          organization_id: string
          title: string
          description: string | null
          location: string | null
          /** An instant. The zone below is what it was meant in. */
          starts_at: string
          /** Exclusive for all-day events. */
          ends_at: string
          all_day: boolean
          timezone: string
          event_type: CalendarEventType
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'calendar_events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      channel_permission_overrides: {
        Row: {
          channel_id: string
          role_id: string
          permission_key: string
          effect: OverrideEffect
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'channel_permission_overrides_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'channel_permission_overrides_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      message_reactions: {
        Row: {
          message_id: string
          user_id: string
          emoji: string
          /** Whichever the message has; the other is null. */
          channel_id: string | null
          conversation_id: string | null
          created_at: string
        }
        /** Both context columns are stamped by a trigger; a client supplies neither. */
        Insert: {
          message_id: string
          user_id: string
          emoji: string
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: 'message_reactions_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
        ]
      }
      message_mentions: {
        Row: {
          message_id: string
          user_id: string
          handle: string
        }
        /** No INSERT policy exists: only the mention trigger writes these. */
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'message_mentions_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
        ]
      }
      message_attachments: {
        Row: {
          id: string
          message_id: string
          storage_path: string
          file_name: string
          /** Read from storage by a trigger; never what the client claimed. */
          mime_type: string
          byte_size: number
          created_at: string
        }
        Insert: {
          message_id: string
          storage_path: string
          file_name: string
          /** Sent for shape only: the trigger overwrites both from storage. */
          mime_type?: string
          byte_size?: number
        }
        /** Immutable: an attachment is a fact about a message that was sent. */
        Update: never
        Relationships: [
          {
            foreignKeyName: 'message_attachments_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
        ]
      }
      conversations: {
        Row: {
          id: string
          organization_id: string
          kind: string
          /** The sorted pair, and the reason a duplicate 1-to-1 cannot exist. */
          member_key: string | null
          created_by: string | null
          created_at: string
        }
        /** No INSERT policy: start_direct_message is the only way one appears. */
        Insert: never
        Update: never
        Relationships: []
      }
      conversation_members: {
        Row: {
          conversation_id: string
          user_id: string
          joined_at: string
        }
        /** No INSERT policy: membership is written only by SECURITY DEFINER code. */
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'conversation_members_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          user_id: string
          last_read_at: string
        }
        /** last_read_at is stamped by a trigger and only moves forward. */
        Insert: {
          conversation_id: string
          user_id: string
        }
        Update: { conversation_id?: string; user_id?: string }
        Relationships: [
          {
            foreignKeyName: 'conversation_reads_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
        ]
      }
      channel_reads: {
        Row: {
          channel_id: string
          user_id: string
          last_read_at: string
        }
        /** last_read_at is stamped by a trigger and only moves forward. */
        Insert: {
          channel_id: string
          user_id: string
        }
        Update: { channel_id?: string; user_id?: string }
        Relationships: [
          {
            foreignKeyName: 'channel_reads_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          id: number
          organization_id: string
          recipient_id: string
          type: string
          entity_type: string
          entity_id: string
          actor_id: string | null
          summary: string
          metadata: Json
          read_at: string | null
          created_at: string
        }
        /** No INSERT policy exists: only SECURITY DEFINER code writes these. */
        Insert: never
        /** A trigger refuses every column but read_at. */
        Update: { read_at: string | null }
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      messages: {
        Row: {
          id: string
          /** Exactly one of channel_id and conversation_id is populated. */
          channel_id: string | null
          conversation_id: string | null
          author_id: string | null
          body: string
          pinned_at: string | null
          pinned_by: string | null
          edited_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          created_at: string
          parent_message_id: string | null
          reply_count: number
          last_reply_at: string | null
        }
        /**
         * Unlike the channel tables, messages are inserted directly: the
         * INSERT policy checks author_id against auth.uid(), so a forged
         * author is refused by the database rather than by this type.
         */
        Insert: {
          /** Exactly one of these two. A CHECK constraint refuses both or neither. */
          channel_id?: string | null
          conversation_id?: string | null
          author_id: string
          body: string
          /** A reply. One level only; a trigger refuses a reply to a reply. */
          parent_message_id?: string | null
        }
        /** A trigger refuses every column but the body from a client. */
        Update: { body: string }
        Relationships: [
          {
            foreignKeyName: 'messages_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'messages_author_id_fkey'
            columns: ['author_id']
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
      suspend_member: {
        Args: { p_member_id: string; p_reason: string; p_days?: number | null }
        Returns: undefined
      }
      unsuspend_member: {
        Args: { p_member_id: string; p_reason?: string | null }
        Returns: undefined
      }
      ban_member: { Args: { p_member_id: string; p_reason: string }; Returns: undefined }
      unban_member: {
        Args: { p_member_id: string; p_reason?: string | null }
        Returns: undefined
      }
      can_in_channel: {
        Args: { p_channel_id: string; p_permission: string }
        Returns: boolean
      }
      can_see_category: { Args: { p_category_id: string }; Returns: boolean }
      channel_organization: { Args: { p_channel_id: string }; Returns: string }
      create_category: {
        Args: { p_organization_id: string; p_name: string }
        Returns: string
      }
      update_category: { Args: { p_category_id: string; p_name: string }; Returns: undefined }
      delete_category: { Args: { p_category_id: string }; Returns: undefined }
      reorder_categories: {
        Args: { p_organization_id: string; p_ids: string[] }
        Returns: undefined
      }
      create_channel: {
        Args: {
          p_organization_id: string
          p_name: string
          p_topic?: string | null
          p_category_id?: string | null
          p_is_private?: boolean
          p_type?: ChannelType
        }
        Returns: string
      }
      voice_room_for: {
        Args: { p_channel_id: string }
        Returns: {
          room_name: string
          channel_id: string
          channel_name: string
          organization_id: string
        }[]
      }
      unread_counts: {
        Args: Record<string, never>
        Returns: { channel_id: string; unread: number; last_read_at: string | null }[]
      }
      search_messages: {
        Args: {
          p_query: string
          p_channel_id?: string | null
          p_limit?: number
          p_before?: string | null
          p_conversation_id?: string | null
        }
        Returns: {
          id: string
          channel_id: string | null
          conversation_id: string | null
          author_id: string | null
          body: string
          created_at: string
          rank: number
          parent_message_id: string | null
        }[]
      }
      channel_member_ids: {
        Args: { p_channel_id: string }
        Returns: string[]
      }
      can_in_conversation: { Args: { p_conversation_id: string }; Returns: boolean }
      start_direct_message: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: string
      }
      conversation_unread_counts: {
        Args: Record<string, never>
        Returns: {
          conversation_id: string
          unread: number
          last_read_at: string | null
          last_message_at: string | null
        }[]
      }
      mark_notifications_read: {
        Args: { p_ids?: number[] | null }
        Returns: number
      }
      create_channel_in_category: {
        Args: {
          p_organization_id: string
          p_name: string
          p_category_name?: string | null
          p_is_private?: boolean
          p_type?: ChannelType
        }
        Returns: string
      }
      update_channel: {
        Args: {
          p_channel_id: string
          p_name?: string | null
          p_topic?: string | null
          p_category_id?: string | null
          p_is_private?: boolean | null
          p_archived?: boolean | null
        }
        Returns: undefined
      }
      delete_channel: { Args: { p_channel_id: string }; Returns: undefined }
      reorder_channels: {
        Args: { p_organization_id: string; p_ids: string[] }
        Returns: undefined
      }
      create_calendar_event: {
        Args: {
          p_organization_id: string
          p_title: string
          p_starts_at: string
          p_ends_at: string
          p_all_day?: boolean
          p_timezone?: string | null
          p_description?: string | null
          p_location?: string | null
          p_event_type?: CalendarEventType
        }
        Returns: string
      }
      update_calendar_event: {
        Args: {
          p_event_id: string
          p_title?: string | null
          p_starts_at?: string | null
          p_ends_at?: string | null
          p_all_day?: boolean | null
          p_timezone?: string | null
          p_description?: string | null
          p_location?: string | null
          p_event_type?: CalendarEventType | null
        }
        Returns: undefined
      }
      delete_calendar_event: { Args: { p_event_id: string }; Returns: undefined }
      delete_message: {
        Args: { p_message_id: string; p_reason?: string | null }
        Returns: undefined
      }
      pin_message: {
        Args: { p_message_id: string; p_pinned?: boolean }
        Returns: undefined
      }
      can_join_channel_topic: {
        Args: { p_topic: string; p_permission: string }
        Returns: boolean
      }
      set_channel_override: {
        Args: {
          p_channel_id: string
          p_role_id: string
          p_permission_key: string
          p_effect?: OverrideEffect | null
        }
        Returns: undefined
      }
    }
    Enums: {
      member_status: MemberStatus
      invitation_status: InvitationStatus
      override_effect: OverrideEffect
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
export type ModerationActionRow = Tables<'moderation_actions'>
export type ChannelRow = Tables<'channels'>
export type ChannelCategoryRow = Tables<'channel_categories'>
export type ChannelOverrideRow = Tables<'channel_permission_overrides'>
export type MessageRow = Tables<'messages'>
