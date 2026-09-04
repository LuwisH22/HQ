import { getSupabase } from '@/lib/supabase'
import { AppError, toAppError } from '@/lib/errors'
import { isDemoSessionActive } from '@/lib/demo-mode'
import { demoChannelService } from '@/services/demo'
import type {
  Channel,
  ChannelCategory,
  ChannelInput,
  ChannelOverride,
  ChannelPatch,
  ChannelService,
  OverrideEffect,
} from './service-contracts'

export type {
  Channel,
  ChannelCategory,
  ChannelInput,
  ChannelOverride,
  ChannelPatch,
} from './service-contracts'

/**
 * Channels, categories and their per-role overrides.
 *
 * Every read here is scoped by RLS through `can_in_channel`, so a private
 * channel is absent from the response rather than filtered out afterwards —
 * guessing an id gains nothing. Every write goes through a SECURITY DEFINER
 * routine that re-checks permission and hierarchy; none of these tables has a
 * client write policy at all.
 */

const CHANNEL_COLUMNS =
  'id, organization_id, category_id, key, name, topic, type, position, is_private, archived_at, created_at, updated_at'

function toChannel(row: {
  id: string
  organization_id: string
  category_id: string | null
  key: string
  name: string
  topic: string | null
  position: number
  is_private: boolean
  archived_at: string | null
}): Channel {
  return {
    id: row.id,
    organizationId: row.organization_id,
    categoryId: row.category_id,
    key: row.key,
    name: row.name,
    topic: row.topic,
    position: row.position,
    isPrivate: row.is_private,
    archivedAt: row.archived_at,
  }
}

export const supabaseChannelService: ChannelService = {
  async listCategories(organizationId: string): Promise<ChannelCategory[]> {
    const { data, error } = await getSupabase()
      .from('channel_categories')
      .select('id, organization_id, name, position')
      .eq('organization_id', organizationId)
      .order('position')

    if (error) throw toAppError(error)
    return (data ?? []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      position: row.position,
    }))
  },

  async listChannels(organizationId: string): Promise<Channel[]> {
    const { data, error } = await getSupabase()
      .from('channels')
      .select(CHANNEL_COLUMNS)
      .eq('organization_id', organizationId)
      .order('position')

    if (error) throw toAppError(error)
    return (data ?? []).map(toChannel)
  },

  async createCategory(organizationId: string, name: string): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_category', {
      p_organization_id: organizationId,
      p_name: name,
    })
    if (error) throw toAppError(error)
    if (typeof data !== 'string') {
      throw new AppError('server', 'The category was not created. Please try again.')
    }
    return data
  },

  async updateCategory(categoryId: string, name: string): Promise<void> {
    const { error } = await getSupabase().rpc('update_category', {
      p_category_id: categoryId,
      p_name: name,
    })
    if (error) throw toAppError(error)
  },

  async deleteCategory(categoryId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_category', { p_category_id: categoryId })
    if (error) throw toAppError(error)
  },

  async reorderCategories(organizationId: string, ids: readonly string[]): Promise<void> {
    const { error } = await getSupabase().rpc('reorder_categories', {
      p_organization_id: organizationId,
      p_ids: [...ids],
    })
    if (error) throw toAppError(error)
  },

  async createChannel(organizationId: string, input: ChannelInput): Promise<string> {
    const { data, error } = await getSupabase().rpc('create_channel', {
      p_organization_id: organizationId,
      p_name: input.name,
      p_topic: input.topic,
      p_category_id: input.categoryId,
      p_is_private: input.isPrivate,
    })
    if (error) throw toAppError(error)
    if (typeof data !== 'string') {
      throw new AppError('server', 'The channel was not created. Please try again.')
    }
    return data
  },

  async updateChannel(channelId: string, patch: ChannelPatch): Promise<void> {
    const { error } = await getSupabase().rpc('update_channel', {
      p_channel_id: channelId,
      p_name: patch.name ?? null,
      p_topic: patch.topic ?? null,
      p_category_id: patch.categoryId ?? null,
      p_is_private: patch.isPrivate ?? null,
      p_archived: patch.archived ?? null,
    })
    if (error) throw toAppError(error)
  },

  /** Permanent. Archiving through `updateChannel` is the reversible option. */
  async deleteChannel(channelId: string): Promise<void> {
    const { error } = await getSupabase().rpc('delete_channel', { p_channel_id: channelId })
    if (error) throw toAppError(error)
  },

  async reorderChannels(organizationId: string, ids: readonly string[]): Promise<void> {
    const { error } = await getSupabase().rpc('reorder_channels', {
      p_organization_id: organizationId,
      p_ids: [...ids],
    })
    if (error) throw toAppError(error)
  },

  async listOverrides(channelId: string): Promise<ChannelOverride[]> {
    const { data, error } = await getSupabase()
      .from('channel_permission_overrides')
      .select('channel_id, role_id, permission_key, effect')
      .eq('channel_id', channelId)

    if (error) throw toAppError(error)
    return (data ?? []).map((row) => ({
      channelId: row.channel_id,
      roleId: row.role_id,
      permissionKey: row.permission_key,
      effect: row.effect,
    }))
  },

  /** `effect: null` clears the override, returning that role to inherit. */
  async setOverride(
    channelId: string,
    roleId: string,
    permissionKey: string,
    effect: OverrideEffect | null,
  ): Promise<void> {
    const { error } = await getSupabase().rpc('set_channel_override', {
      p_channel_id: channelId,
      p_role_id: roleId,
      p_permission_key: permissionKey,
      p_effect: effect,
    })
    if (error) throw toAppError(error)
  },
}

function impl(): ChannelService {
  return isDemoSessionActive() ? demoChannelService : supabaseChannelService
}

export const channelService: ChannelService = {
  listCategories: (organizationId) => impl().listCategories(organizationId),
  listChannels: (organizationId) => impl().listChannels(organizationId),
  createCategory: (organizationId, name) => impl().createCategory(organizationId, name),
  updateCategory: (categoryId, name) => impl().updateCategory(categoryId, name),
  deleteCategory: (categoryId) => impl().deleteCategory(categoryId),
  reorderCategories: (organizationId, ids) => impl().reorderCategories(organizationId, ids),
  createChannel: (organizationId, input) => impl().createChannel(organizationId, input),
  updateChannel: (channelId, patch) => impl().updateChannel(channelId, patch),
  deleteChannel: (channelId) => impl().deleteChannel(channelId),
  reorderChannels: (organizationId, ids) => impl().reorderChannels(organizationId, ids),
  listOverrides: (channelId) => impl().listOverrides(channelId),
  setOverride: (channelId, roleId, permissionKey, effect) =>
    impl().setOverride(channelId, roleId, permissionKey, effect),
}
