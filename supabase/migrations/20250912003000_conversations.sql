-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Conversations
--
-- Direct messages are not channels, and this is the file that says so.
--
-- A channel is a room the organization owns: roles reach into it, overrides
-- grant and deny access to it, the owner can always see it, and every one of
-- those is correct for a place the team meets. None of it is correct for two
-- people talking. So a conversation has no permissions at all. Membership is
-- the whole authorization model: you are in it or you are not, and there is
-- no role, no override and no ownership that can put you in one.
--
-- IN PARTICULAR THE ORGANIZATION OWNER HAS NO BYPASS. `can_in_channel` gives
-- the owner everything by design — an organization they own cannot lock them
-- out of its own rooms — and that reasoning does not transfer to somebody
-- else's private correspondence. can_in_conversation_for below never looks at
-- organizations.owner_id, never looks at member_roles, and never calls
-- has_org_permission. Nothing here can be granted by a permission edit.
--
-- The three rules, in the order they are checked:
--
--   1. you are a member of the conversation,
--   2. you are a member of the organization the conversation belongs to,
--   3. that membership is effectively active — a suspended or banned member
--      reaches nothing, exactly as everywhere else.
--
-- SHAPED FOR GROUPS, USED FOR PAIRS. `kind` and a membership table rather than
-- two user columns, so a group conversation is a row with three members rather
-- than a second architecture. Today only `direct` is created, and only ever
-- with two members.
--
-- No new permission. No change to any existing function, policy or table.
-- Additive only.
-- ===========================================================================

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- 'direct' today. 'group' is the reason this is a column and not an
  -- assumption baked into the shape of the table.
  kind            text not null default 'direct',

  -- The identity of a pair, so "these two already have a conversation" is a
  -- unique index rather than a race between two clients. Written only by
  -- start_direct_message, which sorts the two ids so the pair has one name
  -- whichever way round it is asked for. NULL for a group, which has no
  -- uniqueness rule at all: two people may share several.
  member_key      text,

  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint conversations_kind_known check (kind in ('direct', 'group')),
  constraint conversations_member_key_shape check (
    (kind = 'direct' and member_key is not null and char_length(member_key) = 73)
    or (kind <> 'direct' and member_key is null)
  )
);

comment on table public.conversations is
  'A direct conversation. Membership is the only authorization: no role, override or ownership reaches inside one.';
comment on column public.conversations.member_key is
  'The two member ids, sorted and joined. Exists so a duplicate 1-to-1 conversation is impossible rather than merely unlikely.';

-- The mechanism that makes a duplicate impossible. Partial, because only a
-- direct conversation is unique in its pair.
create unique index conversations_direct_pair_idx
  on public.conversations (organization_id, member_key)
  where kind = 'direct';

create index conversations_organization_idx on public.conversations (organization_id);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),

  primary key (conversation_id, user_id)
);

comment on table public.conversation_members is
  'Who is in a conversation. The authority for DM visibility, written only by SECURITY DEFINER routines.';

-- "Which conversations am I in" is the sidebar's only question.
create index conversation_members_user_idx on public.conversation_members (user_id);

-- --- A conversation cannot reach across organizations -----------------------
--
-- Only start_direct_message writes this table, and it checks both members
-- already. This is the constraint underneath that check: a future routine
-- cannot add somebody from another organization by forgetting to look.

create or replace function public.tg_conversation_member_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.conversations where id = new.conversation_id;

  if v_org is null then
    raise exception 'Conversation not found' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = v_org and m.user_id = new.user_id
  ) then
    raise exception 'A conversation member must belong to its organization'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

create trigger conversation_members_same_org
  before insert or update on public.conversation_members
  for each row execute function public.tg_conversation_member_org();

-- --- Authorization ----------------------------------------------------------
--
-- SECURITY DEFINER, and not because the rule needs privilege: the policy on
-- conversation_members calls this, and a policy that queried
-- conversation_members directly would recurse into itself. DEFINER reads the
-- table once, without RLS, and answers a boolean. Same reasoning as
-- can_in_channel, same conventions: pinned empty search_path, revoked from
-- anon.
--
-- The `_for` variant exists for the same reason C2 extracted the channel one:
-- the mention trigger has to ask about somebody who is not the caller.

create or replace function public.can_in_conversation_for(
  p_user_id uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.conversation_members cm
    join public.conversations c
      on c.id = cm.conversation_id
    join public.organization_members om
      on om.organization_id = c.organization_id
     and om.user_id = cm.user_id
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      -- Suspended and banned members reach nothing, here as everywhere.
      and public.is_effectively_active(om.status, om.suspended_until)
  );
$fn$;

comment on function public.can_in_conversation_for is
  'Whether a named member may take part in a conversation. Membership plus an effectively active membership of the same organization, and nothing else — no role, no override, no owner bypass.';

create or replace function public.can_in_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_in_conversation_for((select auth.uid()), p_conversation_id);
$fn$;

comment on function public.can_in_conversation is
  'Whether the caller may take part in a conversation. can_in_conversation_for with auth.uid() supplied.';

revoke execute on function public.can_in_conversation_for(uuid, uuid) from public, anon;
revoke execute on function public.can_in_conversation(uuid) from public, anon;
grant execute on function public.can_in_conversation_for(uuid, uuid) to authenticated;
grant execute on function public.can_in_conversation(uuid) to authenticated;

-- --- RLS --------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;

create policy "Members can read their own conversations"
  on public.conversations for select to authenticated
  using (public.can_in_conversation(id));

-- The roster of a conversation you are in. Seeing who else is in it is the
-- point of opening it; seeing anybody in one you are not in is not available
-- at all, because the same check gates the row.
create policy "Members can read who else is in their conversations"
  on public.conversation_members for select to authenticated
  using (public.can_in_conversation(conversation_id));

-- No INSERT, UPDATE or DELETE policy on either table, on purpose. Membership
-- is what authorizes everything else about a DM, so it is written only by the
-- routine below — a client cannot add itself to a conversation, cannot add
-- somebody else to one, and cannot remove anybody from one.

revoke all on public.conversations from anon;
revoke all on public.conversation_members from anon;
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;

-- --- Starting one -----------------------------------------------------------
--
-- Idempotent by construction. The unique index is the arbiter, so two clients
-- pressing the button at the same instant produce one conversation and both
-- get its id: whichever loses the insert reads the winner's row.
--
-- The organization is a parameter and then validated, never trusted: both the
-- caller and the other member must be effectively active members of it. That
-- is also what rejects a cross-organization DM, without a separate check.

create or replace function public.start_direct_message(
  p_organization_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_member public.organization_members;
  v_other  public.organization_members;
  v_key    text;
  v_id     uuid;
begin
  if v_actor is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- A conversation with yourself is not a conversation. Rejected rather than
  -- quietly returning something, so a client bug surfaces instead of creating
  -- a room nobody can leave.
  if p_user_id is null or p_user_id = v_actor then
    raise exception 'You cannot start a direct message with yourself'
      using errcode = 'check_violation';
  end if;

  select * into v_member
  from public.organization_members
  where organization_id = p_organization_id and user_id = v_actor;

  if v_member is null
     or not public.is_effectively_active(v_member.status, v_member.suspended_until) then
    raise exception 'You do not have access to that organization'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_other
  from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;

  -- Not found and not active are the same answer on purpose: neither tells
  -- the caller anything about somebody they cannot message.
  if v_other is null
     or not public.is_effectively_active(v_other.status, v_other.suspended_until) then
    raise exception 'That member is not available' using errcode = 'no_data_found';
  end if;

  v_key := least(v_actor::text, p_user_id::text) || ':' ||
           greatest(v_actor::text, p_user_id::text);

  insert into public.conversations (organization_id, kind, member_key, created_by)
  values (p_organization_id, 'direct', v_key, v_actor)
  on conflict (organization_id, member_key) where kind = 'direct' do nothing
  returning id into v_id;

  if v_id is null then
    -- Somebody else created it, possibly a millisecond ago. Theirs is the one.
    select id into v_id
    from public.conversations
    where organization_id = p_organization_id
      and kind = 'direct'
      and member_key = v_key;

    return v_id;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_actor), (v_id, p_user_id);

  return v_id;
end;
$fn$;

comment on function public.start_direct_message is
  'Opens the 1-to-1 conversation between the caller and another member, creating it once. Idempotent: the unique index on (organization_id, member_key) is what makes a duplicate impossible under concurrency.';

revoke execute on function public.start_direct_message(uuid, uuid) from public, anon;
grant execute on function public.start_direct_message(uuid, uuid) to authenticated;
