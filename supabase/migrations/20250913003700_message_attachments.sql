-- ===========================================================================
-- LFG HQ · Phase 2 · C3 · Attachments
--
-- One subsystem for every kind of message. A channel message, a direct
-- message and a thread reply are all rows in `messages`, so an attachment
-- points at a message and inherits whatever that message's visibility already
-- is — there is no dm_attachments, no channel_attachments, and no second
-- authorization model to keep in step with the first.
--
-- TWO HALVES THAT MUST AGREE. The bytes live in a private Storage bucket; the
-- metadata lives here. The link between them is the object's name, and both
-- ends are checked:
--
--   * you may only WRITE an object under your own id, so nobody can upload
--     into somebody else's prefix or overwrite their file;
--   * you may only READ an object that is attached to a message you can
--     already read — or that is your own, so an upload can be abandoned and
--     cleaned up before it is ever attached to anything;
--   * you may only ATTACH an object that exists, that you uploaded, and that
--     the storage service itself vouches for. The trigger below reads its real
--     size and content type out of `storage.objects` and overwrites whatever
--     the client claimed, so neither is something a client asserts.
--
-- THE DECLARED CONTENT TYPE IS NOT A SECURITY BOUNDARY and nothing here treats
-- it as one. It decides how a file is offered — an image is rendered in an
-- <img>, everything else is a download and nothing else — so a file that lies
-- about being a PNG simply fails to draw. Nothing is ever executed, framed, or
-- rendered as markup.
--
-- The bucket is private. Every read is a short-lived signed URL, minted only
-- for an object the caller could select, which is to say only for a message
-- they can see. No service-role key is involved at any point.
--
-- Additive. One existing function is replaced — tg_message_soft_deleted, whose
-- rollback source is named at the site.
-- ===========================================================================

-- --- The bucket -------------------------------------------------------------
--
-- `file_size_limit` and `allowed_mime_types` are enforced by the storage
-- service before a byte is written, which is the only place a limit can be
-- enforced honestly: the client's own check is a courtesy that saves an
-- upload, not a rule.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  26214400,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'text/plain',
    'application/zip', 'application/x-zip-compressed'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- --- The metadata -----------------------------------------------------------

create table public.message_attachments (
  id           uuid primary key default gen_random_uuid(),

  -- CASCADE, and narrowly: it removes the metadata of exactly this message and
  -- nothing else, the same way a reaction or a mention goes. The bytes are not
  -- touched by it — see the note on orphans at the end of this file.
  message_id   uuid not null references public.messages (id) on delete cascade,

  -- The object's name in the bucket, `{uploader_id}/{uuid}`.
  storage_path text not null,

  file_name    text not null,
  -- Both of these are read out of storage by the trigger below, never taken
  -- from the client.
  mime_type    text not null,
  byte_size    bigint not null,

  created_at   timestamptz not null default now(),

  -- One object, one attachment. Without this the same file could be attached
  -- to two messages, and deleting one of them would leave the other pointing
  -- at bytes somebody else's lifecycle now governs.
  constraint message_attachments_object_once unique (storage_path),

  constraint message_attachments_size check (byte_size between 1 and 26214400),
  constraint message_attachments_name_length check (char_length(file_name) between 1 and 255),
  constraint message_attachments_mime_length check (char_length(mime_type) between 1 and 128),
  constraint message_attachments_path_shape check (char_length(storage_path) between 3 and 512)
);

comment on table public.message_attachments is
  'Files attached to a message. Visibility inherits from the messages policy; size and content type are read from storage, never from the client.';

create index message_attachments_message_idx on public.message_attachments (message_id);

-- --- What storage says is what is recorded ---------------------------------

create or replace function public.tg_attachment_from_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_owner  text;
  v_meta   jsonb;
  v_size   bigint;
  v_mime   text;
begin
  select coalesce(o.owner::text, o.owner_id), o.metadata
  into v_owner, v_meta
  from storage.objects o
  where o.bucket_id = 'message-attachments'
    and o.name = new.storage_path;

  if not found then
    raise exception 'That file has not been uploaded' using errcode = 'no_data_found';
  end if;

  -- The object's own record of who put it there. A client cannot attach
  -- somebody else's file to its own message and publish it that way.
  if v_owner is distinct from v_actor::text then
    raise exception 'That file does not belong to you'
      using errcode = 'insufficient_privilege';
  end if;

  v_size := coalesce((v_meta ->> 'size')::bigint, 0);
  v_mime := coalesce(nullif(v_meta ->> 'mimetype', ''), 'application/octet-stream');

  if v_size <= 0 then
    raise exception 'That file is empty' using errcode = 'check_violation';
  end if;
  -- The bucket refuses anything larger before it is written; this is the same
  -- rule stated where the row is created, so the two cannot drift apart.
  if v_size > 26214400 then
    raise exception 'That file is larger than 25 MB' using errcode = 'check_violation';
  end if;

  new.byte_size := v_size;
  new.mime_type := left(v_mime, 128);
  new.file_name := left(btrim(coalesce(new.file_name, '')), 255);

  if new.file_name = '' then
    new.file_name := 'attachment';
  end if;

  return new;
end;
$fn$;

create trigger message_attachments_from_storage
  before insert on public.message_attachments
  for each row execute function public.tg_attachment_from_storage();

-- --- RLS --------------------------------------------------------------------

alter table public.message_attachments enable row level security;

-- Inherited wholesale from the messages policy, the same way reactions and
-- mentions are: an attachment on a message you cannot read is absent, not
-- filtered.
create policy "Members can read attachments on messages they can see"
  on public.message_attachments for select to authenticated
  using (message_id in (select id from public.messages));

-- Attaching is part of sending, so it asks exactly what sending asks — in a
-- channel, `messages.send` there; in a conversation, being in it. No new
-- permission, and no second copy of either rule.
create policy "Authors can attach to their own live message"
  on public.message_attachments for insert to authenticated
  with check (
    -- Only into your own prefix. The trigger checks the object's owner too;
    -- this is the same rule where the path is, so a malformed one is refused
    -- before anything is read.
    split_part(storage_path, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
      from public.messages m
      where m.id = message_id
        and m.author_id = (select auth.uid())
        and m.deleted_at is null
        and (
          (m.channel_id is not null and public.can_in_channel(m.channel_id, 'messages.send'))
          or (m.conversation_id is not null and public.can_in_conversation(m.conversation_id))
        )
    )
  );

-- No UPDATE and no DELETE policy, on purpose. An attachment is a fact about a
-- message that was sent; it is not edited afterwards, and it goes when the
-- message does.

revoke all on public.message_attachments from anon;
grant select, insert on public.message_attachments to authenticated;

-- --- Storage policies -------------------------------------------------------

drop policy if exists "Attachments are uploaded into your own prefix" on storage.objects;
create policy "Attachments are uploaded into your own prefix"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Attachments are readable where their message is" on storage.objects;
create policy "Attachments are readable where their message is"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and (
      -- Your own, so an upload that was never sent can still be tidied away.
      (storage.foldername(name))[1] = (select auth.uid())::text
      -- Or attached to a message you can read. The subquery is itself subject
      -- to the policy above, so "an attachment row I can see" already means
      -- "a message I can see" — one rule, evaluated once, in one place.
      or exists (
        select 1 from public.message_attachments a where a.storage_path = name
      )
    )
  );

drop policy if exists "Attachments are removable only by the uploader" on storage.objects;
create policy "Attachments are removable only by the uploader"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE policy: an object is written once. That is also what stops an
-- upsert from overwriting anybody's file, including your own.

-- --- Lifecycle --------------------------------------------------------------
--
-- ROLLBACK: the previous body of tg_message_soft_deleted is in
-- supabase/migrations/20250911002900_message_mentions.sql. The only addition
-- is the attachment delete.
--
-- A soft-deleted message keeps its row so replies stay reachable, and its body
-- is cleared. Its attachments have to go the same way its reactions and
-- mentions do: the metadata is still readable through the placeholder
-- otherwise, which would leave a file listed under a message whose words are
-- gone. A hard delete takes them through the foreign key.

create or replace function public.tg_message_soft_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- Restored rather than switched off: the calling routine may still be
  -- inside its own guarded section.
  v_previous text := coalesce(current_setting('lfghq.messaging', true), '');
begin
  delete from public.message_reactions where message_id = new.id;
  delete from public.message_mentions where message_id = new.id;
  delete from public.message_attachments where message_id = new.id;

  if new.pinned_at is not null then
    perform set_config('lfghq.messaging', 'on', true);

    update public.messages
    set pinned_at = null, pinned_by = null
    where id = new.id;

    perform set_config('lfghq.messaging', v_previous, true);
  end if;

  return null;
end;
$fn$;

-- --- Orphans, and what is honestly possible --------------------------------
--
-- Deleting a message removes the metadata and leaves the bytes. There is no
-- cron in this project, no queue and no worker, and adding one to sweep a
-- handful of files a year would be a larger commitment than the problem.
--
-- So cleanup is best-effort and lives where the authority already is: the
-- uploader may delete their own objects, and the client does exactly that when
-- an upload is abandoned before it is sent and when an author deletes their own
-- message. What is left over is the case where somebody else removes a message
-- — a moderator in a channel — because only the uploader may delete the bytes
-- and the moderator is not them.
--
-- Those objects are unreachable rather than exposed: with no attachment row,
-- the storage read policy admits only the uploader, and the metadata that
-- would name the path is gone. They cost storage and nothing else, and can be
-- swept from the dashboard whenever that becomes worth doing.
