-- Task participant profiles may expose only the VIP display flag through RLS.
-- Existing profile row policies still determine which profile rows are visible.
grant select (is_vip) on table public.profiles to authenticated;
