-- ===========================================================================
-- Phase 4 · Voice — Step 3: listen-only, one channel at a time.
--
-- `voice.speak` already resolves through can_in_channel_for, so a channel
-- override would work the moment the table accepted one. The CHECK that keeps
-- the override table to a safe subset was written before voice existed, and
-- its own comment says what the subset is for: "a channel decides who may see
-- it and who may speak in it". A voice channel deciding who may speak in it is
-- the same sentence.
--
-- Additive only. Every existing row still satisfies the wider constraint.
-- ===========================================================================

alter table public.channel_permission_overrides
  drop constraint if exists channel_overrides_permission_subset;

alter table public.channel_permission_overrides
  add constraint channel_overrides_permission_subset check (
    permission_key in (
      'channels.view', 'messages.send', 'messages.pin', 'messages.moderate', 'voice.speak'
    )
  );

comment on constraint channel_overrides_permission_subset
  on public.channel_permission_overrides is
  'The safe subset. A channel decides who may see it, who may write in it and who may be heard in it; it does not decide who may run the organization.';
