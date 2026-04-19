-- ═══════════════════════════════════════════════════════════
--  Census Survey — Supabase Database Schema
-- ═══════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
--  1. Surveyor Profiles (Admin Approval System)
-- ═══════════════════════════════════════════════════════════
drop table if exists surveyor_profiles cascade;

create table surveyor_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  name text not null,
  email text not null,
  approved boolean default false,
  force_password_reset boolean default false
);

-- Enable RLS
alter table surveyor_profiles enable row level security;

-- Users can read their own profile
create policy "Users can read own profile"
  on surveyor_profiles
  for select
  to authenticated
  using (id = auth.uid());

-- Users can update their own profile (limited fields)
create policy "Users can update own profile"
  on surveyor_profiles
  for update
  to authenticated
  using (id = auth.uid());

-- Insert on signup (trigger will handle this)
create policy "Allow profile inserts"
  on surveyor_profiles
  for insert
  to authenticated
  with check (true);

-- Allow admin read access (dashboard PIN protected, no service key needed)
create policy "Allow admin select all profiles"
  on surveyor_profiles
  for select
  to anon
  using (true);

-- Allow admin update access
create policy "Allow admin update all profiles"
  on surveyor_profiles
  for update
  to anon
  using (true);

-- Indexes
create index idx_surveyor_profiles_approved on surveyor_profiles(approved);
create index idx_surveyor_profiles_email on surveyor_profiles(email);

-- ═══════════════════════════════════════════════════════════
--  2. Auto-create profile on signup (Trigger)
-- ═══════════════════════════════════════════════════════════
create or replace function public.handle_new_surveyor()
returns trigger as $$
begin
  insert into public.surveyor_profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

-- Attach trigger to auth.users
drop trigger if exists on_auth_user_created_surveyor on auth.users;
create trigger on_auth_user_created_surveyor
  after insert on auth.users
  for each row execute function public.handle_new_surveyor();

-- ═══════════════════════════════════════════════════════════
--  3. Census Surveys Table
-- ═══════════════════════════════════════════════════════════
drop table if exists census_surveys cascade;

create table census_surveys (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  user_id uuid references auth.users(id) on delete cascade,
  surveyor_email text not null,

  -- Step 1: House Identification
  q1_line_number integer,
  q2_building_number text,
  q3_census_house_number text,

  -- Step 2: House Construction
  q4_floor_material text,
  q5_wall_material text,
  q6_roof_material text,

  -- Step 3: House Usage & Condition
  q7_house_usage text,
  q7a_lock_hai text,
  q7b_sansthagat_hai text,
  q7b_house_usage_detail text,
  q8_house_condition text,

  -- Step 4: Family Details
  q9_family_serial text,
  q10_persons_count integer,
  q11_head_name text,
  q12_gender text,
  q13_category text,

  -- Step 5: Ownership & Rooms
  q14_ownership text,
  q15_rooms_count integer,
  q16_married_couples integer,

  -- Step 6: Water & Sanitation
  q17_water_source text,
  q18_water_availability text,
  q19_light_source text,
  q20_toilet_facility text,
  q21_toilet_type text,
  q22_drainage text,
  q23_bathing_facility text,

  -- Step 7: Kitchen & Fuel
  q24_kitchen_gas text,
  q25_cooking_fuel text,

  -- Step 8: Assets & Facilities
  q26_radio text,
  q27_tv text,
  q28_internet text,
  q29_laptop text,
  q30_phone text,
  q31_cycle_scooter text,
  q32_car text,

  -- Step 9: Food & Contact
  q33_main_grain text,
  q34_mobile_number text
);

-- Enable RLS
alter table census_surveys enable row level security;

-- Insert: any authenticated user
create policy "Users can insert surveys"
  on census_surveys
  for insert
  to authenticated
  with check (auth.uid() is not null);

-- Select: users see only their own
create policy "Users can view own surveys"
  on census_surveys
  for select
  to authenticated
  using (user_id = auth.uid());

-- Update: users update only their own
create policy "Users can update own surveys"
  on census_surveys
  for update
  to authenticated
  using (user_id = auth.uid());

-- Delete: users delete only their own
create policy "Users can delete own surveys"
  on census_surveys
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Admin can read all surveys (dashboard access)
create policy "Admin can view all surveys"
  on census_surveys
  for select
  to anon
  using (true);

-- Indexes
create index idx_census_user_id on census_surveys(user_id);
create index idx_census_created on census_surveys(created_at desc);
