-- Run once in Supabase SQL Editor for existing Census Survey databases.
alter table surveyor_profiles add column if not exists hlb_number text;
