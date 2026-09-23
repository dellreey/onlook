alter table public.frames
  add column if not exists driven_page_id varchar,
  add column if not exists driven_variant_id varchar;
