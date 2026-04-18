-- ═══════════════════════════════════════════════════════════
--  Census Survey — Supabase Database Schema
-- ═══════════════════════════════════════════════════════════

-- Enable RLS
alter table if exists census_surveys force row level security;

-- Drop if exists (for fresh setup)
drop table if exists census_surveys cascade;

-- ═══════════════════════════════════════════════════════════
--  Main Survey Table
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
--  Row Level Security Policies
-- ═══════════════════════════════════════════════════════════

-- Allow authenticated users to insert records
create policy "Users can insert their own surveys"
  on census_surveys
  for insert
  to authenticated
  with check (auth.uid() is not null);

-- Allow users to read only their own records
create policy "Users can view their own surveys"
  on census_surveys
  for select
  to authenticated
  using (user_id = auth.uid());

-- Allow users to update only their own records
create policy "Users can update their own surveys"
  on census_surveys
  for update
  to authenticated
  using (user_id = auth.uid());

-- Allow users to delete only their own records
create policy "Users can delete their own surveys"
  on census_surveys
  for delete
  to authenticated
  using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
--  Indexes for performance
-- ═══════════════════════════════════════════════════════════
create index idx_census_surveyor on census_surveys(surveyor_email);
create index idx_census_created on census_surveys(created_at desc);

-- ═══════════════════════════════════════════════════════════
--  Optional: Admin view (uncomment if you have an admin role)
-- ═══════════════════════════════════════════════════════════
-- create policy "Admins can view all surveys"
--   on census_surveys
--   for select
--   to authenticated
--   using (exists (
--     select 1 from auth.users where auth.users.id = auth.uid() and auth.users.raw_user_meta_data->>'role' = 'admin'
--   ));
