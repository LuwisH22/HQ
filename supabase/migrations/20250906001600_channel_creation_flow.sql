-- ===========================================================================
-- LFG HQ · Phase 1.5 · B3 (follow-up) · A channel and its section, together
--
-- The settings screen offered two unrelated buttons: one made a category, the
-- other made a channel, and a channel made that way was always uncategorised
-- however carefully the category name had just been typed above it.
--
-- Doing both from the browser would mean two round trips and two
-- transactions. A channel that failed to insert would leave an empty category
-- standing with nothing to explain it, and the person would be left tidying
-- up after a button they pressed once.
--
-- This routine does both inside one transaction. It creates nothing itself:
-- it finds an existing category or delegates to `create_category`, then
-- delegates to `create_channel`. Every permission check, slug rule, position
-- rule and audit entry stays exactly where it already lived — there is still
-- one way to create a category and one way to create a channel. If the
-- channel raises, the category insert goes with it.
--
-- Additive only.
-- ===========================================================================

create or replace function public.create_channel_in_category(
  p_organization_id uuid,
  p_name text,
  p_category_name text default null,
  p_is_private boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_category_name text := nullif(btrim(coalesce(p_category_name, '')), '');
  v_category_id   uuid;
begin
  -- Checked here as well as inside create_channel, so that the lookup below
  -- runs only for someone already entitled to be creating channels in this
  -- organization. Without it, a caller could tell whether a category name
  -- exists elsewhere by which of two refusals came back.
  if not public.has_org_permission(p_organization_id, 'channels.create') then
    raise exception 'You do not have permission to create channels'
      using errcode = 'insufficient_privilege';
  end if;

  if v_category_name is not null then
    -- Reuse rather than duplicate. Case-insensitive, because "Competitive"
    -- and "competitive" are one section to everyone reading the sidebar, and
    -- two identically named cards would be a puzzle rather than a choice.
    select id into v_category_id
    from public.channel_categories
    where organization_id = p_organization_id
      and lower(name) = lower(v_category_name)
    order by position, created_at
    limit 1;

    -- Creating a category is a stronger permission than creating a channel.
    -- Someone who may only create channels can still file one under a section
    -- that exists; naming a new one is refused, and takes the channel with it.
    if v_category_id is null then
      v_category_id := public.create_category(p_organization_id, v_category_name);
    end if;
  end if;

  return public.create_channel(
    p_organization_id, p_name, null, v_category_id, coalesce(p_is_private, false)
  );
end;
$fn$;

comment on function public.create_channel_in_category(uuid, text, text, boolean) is
  'Creates a channel and, when named and absent, the category holding it — atomically. Delegates to create_category and create_channel; adds no rules of its own.';

revoke execute on function public.create_channel_in_category(uuid, text, text, boolean)
  from public, anon;
grant execute on function public.create_channel_in_category(uuid, text, text, boolean)
  to authenticated;
