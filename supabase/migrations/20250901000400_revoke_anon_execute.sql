-- ===========================================================================
-- LFG HQ · Phase 1 · Close the anonymous function surface
--
-- Found by running scripts/check-backend.mjs against the live project: the
-- five authorization helpers were callable by an anonymous caller holding the
-- publishable key.
--
-- Nothing leaked — each reads `auth.uid()`, which is NULL without a session,
-- so they returned false / null / empty. But they are SECURITY DEFINER: they
-- execute as the owner and bypass RLS internally. Leaving them reachable means
-- any future edit that forgets an `auth.uid()` check is instantly exposed to
-- the internet. They should never have been callable without a session.
--
-- Cause: PostgreSQL grants EXECUTE to PUBLIC on every new function.
-- 20250901000250 granted them to `authenticated` but never revoked the
-- implicit PUBLIC grant, so `anon` inherited it. The invitation routines in
-- that migration did revoke from `public, anon` explicitly, which is why they
-- were already closed.
-- ===========================================================================

-- Revoking from PUBLIC also removes what `authenticated` inherited, so each
-- grant is restated below.
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_permission(uuid, text) from public, anon;
revoke execute on function public.my_role_rank(uuid) from public, anon;
revoke execute on function public.shares_organization_with(uuid) from public, anon;
revoke execute on function public.my_permissions(uuid) from public, anon;

-- `authenticated` must keep EXECUTE on the first three: RLS policy expressions
-- are evaluated as the calling role, so a member without EXECUTE on
-- is_org_member() would be denied every row the policies protect.
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_permission(uuid, text) to authenticated;
grant execute on function public.my_role_rank(uuid) to authenticated;
grant execute on function public.shares_organization_with(uuid) to authenticated;
grant execute on function public.my_permissions(uuid) to authenticated;
