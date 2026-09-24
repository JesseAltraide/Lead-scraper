-- "Keep searching" raises a run's limits and resumes it. It had no cap: a user
-- could raise the limits indefinitely, one click at a time, spending real
-- Apify and Anthropic budget each round with nothing stopping them.
--
-- Capped at 3, counted on the run record for the same reason every other limit
-- lives there: the number the screen shows and the number the API enforces have
-- to be the same number, read from the same row.
alter table runs add column if not exists continue_count int not null default 0;

alter table runs drop constraint if exists runs_continue_cap;
alter table runs add constraint runs_continue_cap check (continue_count between 0 and 3);
