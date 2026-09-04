-- ===========================================================================
-- LFG HQ · development seed data
--
-- FOR LOCAL DEVELOPMENT ONLY. Never run this against a production project.
-- It writes directly into auth.users, which only the local stack permits.
--
-- All identities below are fictional. Shared password for every demo account:
--
--     LfgHq!Dev2025
--
-- ===========================================================================

do $seed$
declare
  v_org_id      uuid;
  v_owner_id    uuid;
  v_user_id     uuid;
  v_role_id     uuid;
  v_password    text := 'LfgHq!Dev2025';
  v_member      record;
begin
  if exists (select 1 from public.organizations where slug = 'lfg') then
    raise notice 'Seed data already present — skipping.';
    return;
  end if;

  -- --- Demo accounts ------------------------------------------------------
  for v_member in
    select * from (values
      ('owner@lfg.test',   'Riley Vance',    'vance',    'Owner',            'owner'),
      ('admin@lfg.test',   'Jordan Okafor',  'jokafor',  'Operations Admin', 'admin'),
      ('manager@lfg.test', 'Sam Petrov',     'spetrov',  'Team Manager',     'manager'),
      ('coach@lfg.test',   'Ana Ferreira',   'anaf',     'Head Coach',       'coach'),
      ('player@lfg.test',  'Kai Nakamura',   'kaidrop',  'Entry Fragger',    'player'),
      ('staff@lfg.test',   'Morgan Ellis',   'mellis',   'Content Producer', 'staff')
    ) as t(email, full_name, display_name, title, role_key)
  loop
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_member.email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('full_name', v_member.full_name, 'display_name', v_member.display_name),
      now(), now(), '', '', '', ''
    );

    -- GoTrue needs a matching identity row for password sign-in.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', v_member.email, 'email_verified', true),
      'email',
      now(), now(), now()
    );

    -- The on_auth_user_created trigger has created the profile by now.
    update public.profiles
    set title = v_member.title,
        timezone = 'Europe/Berlin',
        bio = case v_member.role_key
                when 'owner'  then 'Running the org. Ping me for anything structural.'
                when 'coach'  then 'VOD reviews Tuesdays and Fridays.'
                when 'player' then 'Scrims 18:00–22:00 CET.'
                else null
              end
    where id = v_user_id;

    if v_member.role_key = 'owner' then
      v_owner_id := v_user_id;
    end if;
  end loop;

  -- --- Organization -------------------------------------------------------
  -- bootstrap_organization materialises the six system roles with their
  -- template permissions and installs the owner.
  v_org_id := public.bootstrap_organization(
    'lfg',
    'LFG Esports',
    v_owner_id,
    'Competitive since day one.',
    'Europe/Berlin'
  );

  -- --- Remaining members --------------------------------------------------
  for v_member in
    select p.id as user_id, p.email,
           case
             when p.email = 'admin@lfg.test'   then 'admin'
             when p.email = 'manager@lfg.test' then 'manager'
             when p.email = 'coach@lfg.test'   then 'coach'
             when p.email = 'player@lfg.test'  then 'player'
             when p.email = 'staff@lfg.test'   then 'staff'
           end as role_key
    from public.profiles p
    where p.id <> v_owner_id
  loop
    select id into v_role_id
    from public.roles
    where organization_id = v_org_id and key = v_member.role_key;

    insert into public.organization_members (organization_id, user_id, role_id, status)
    values (v_org_id, v_member.user_id, v_role_id, 'active');
  end loop;

  -- --- A little history so the dashboard is not empty on first run --------
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, summary)
  select v_org_id, v_owner_id, 'member.added', 'organization_member', m.id::text,
         format('%s joined as %s', p.display_name, r.name)
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  join public.roles r on r.id = m.role_id
  where m.organization_id = v_org_id and m.user_id <> v_owner_id;

  -- --- One live invitation to exercise the members screen -----------------
  select id into v_role_id from public.roles
  where organization_id = v_org_id and key = 'player';

  insert into public.invitations
    (organization_id, email, role_id, invited_by, token_hash, expires_at)
  values
    (v_org_id, 'tryout@lfg.test', v_role_id, v_owner_id,
     public.hash_invitation_token('dev-seed-invitation-token'),
     now() + interval '7 days');

  raise notice 'Seeded organization "LFG Esports" with 6 members. Password: %', v_password;
end;
$seed$;
