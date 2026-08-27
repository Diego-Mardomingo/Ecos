-- Tablas de Ecos: columnas, constraints, índices y triggers.
-- Instantánea del proyecto real. Ver README.md de este directorio.
--
-- Solo objetos `ecos_*`: la base de datos se comparte con otra aplicación y las tablas
-- `hubgames_*` no son de este proyecto.

create extension if not exists unaccent;

-- ---------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------

create table if not exists public.ecos_songs (
  id uuid not null default gen_random_uuid(),
  title text not null,
  artist_name text not null,
  album_title text not null,
  cover_url text not null,
  release_date text,
  genre text,
  explicit boolean default false,
  created_at timestamp with time zone default now(),
  spotify_id text,
  popularity integer,
  duration_ms integer,
  tempo double precision,
  danceability double precision,
  energy double precision,
  is_active boolean default true,
  spotify_playlist_id text,
  raw_spotify_data jsonb,
  preview_url text,
  spotify_playlist_name text,
  preview_duration_seconds double precision,
  -- Clave canónica título+artista. La calcula el trigger ecos_songs_dedupe_key; no se escribe
  -- a mano. Existe para poder imponer un único sobre ella: Spotify publica la misma canción
  -- como single y dentro de un álbum, con distinto spotify_id y distinta carátula, y el único
  -- de spotify_id no ve esos duplicados.
  dedupe_key text not null
);

create table if not exists public.ecos_games (
  id uuid not null default gen_random_uuid(),
  song_id uuid not null,
  date date not null,
  game_number integer not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.ecos_profiles (
  user_id uuid not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  role text,
  username text,
  show_avatar_in_rankings boolean not null default true,
  notifications_modal_shown boolean not null default false,
  notifications_modal_dismiss_count integer not null default 0
);

create table if not exists public.ecos_guesses (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid not null,
  attempt_number integer not null,
  guess_text text not null,
  correct boolean not null default false,
  created_at timestamp with time zone default now(),
  correct_artist boolean,
  correct_album boolean
);

create table if not exists public.ecos_scores (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid not null,
  points integer not null default 0,
  guesses_used integer not null default 6,
  correct boolean not null default false,
  created_at timestamp with time zone default now()
);

create table if not exists public.ecos_leaderboard (
  user_id uuid not null,
  total_points integer not null default 0,
  games_played integer not null default 0,
  games_won integer not null default 0,
  streak integer not null default 0,
  global_rank integer,
  last_played date,
  updated_at timestamp with time zone default now(),
  max_streak integer default 0
);

create table if not exists public.ecos_reports (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  game_id uuid,
  song_id uuid,
  reason text not null,
  description text,
  status text default 'pending'::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.ecos_feedback (
  id uuid not null default gen_random_uuid(),
  type text not null,
  message text not null,
  email text,
  user_id uuid,
  created_at timestamp with time zone not null default now(),
  status text not null default 'pending'::text
);

create table if not exists public.ecos_push_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  subscription jsonb not null,
  enabled boolean not null default true,
  notification_daily_game boolean not null default true,
  endpoint text default (subscription ->> 'endpoint'::text),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create table if not exists public.ecos_spotify_playlists (
  id uuid not null default gen_random_uuid(),
  spotify_playlist_id text not null,
  spotify_playlist_name text,
  source_url text,
  ingest_mode text not null default 'default'::text,
  is_active boolean not null default true,
  last_ingested_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  sort_order integer
);

create table if not exists public.ecos_system_logs (
  id uuid not null default gen_random_uuid(),
  job_type text not null,
  status text not null,
  ran_at timestamp with time zone default now(),
  duration_ms integer,
  summary text,
  errors text[],
  details jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------------------------

alter table public.ecos_songs add constraint ecos_songs_pkey PRIMARY KEY (id);
alter table public.ecos_songs add constraint ecos_songs_spotify_id_key UNIQUE (spotify_id);

alter table public.ecos_games add constraint ecos_games_pkey PRIMARY KEY (id);
alter table public.ecos_games add constraint ecos_games_date_key UNIQUE (date);
alter table public.ecos_games add constraint ecos_games_game_number_key UNIQUE (game_number);
alter table public.ecos_games add constraint ecos_games_song_id_fkey
  FOREIGN KEY (song_id) REFERENCES ecos_songs(id) ON DELETE RESTRICT;

alter table public.ecos_profiles add constraint ecos_profiles_pkey PRIMARY KEY (user_id);
alter table public.ecos_profiles add constraint ecos_profiles_username_key UNIQUE (username);
alter table public.ecos_profiles add constraint ecos_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.ecos_profiles add constraint ecos_profiles_notifications_modal_dismiss_count_check
  CHECK (((notifications_modal_dismiss_count >= 0) AND (notifications_modal_dismiss_count <= 3)));

alter table public.ecos_guesses add constraint ecos_guesses_pkey PRIMARY KEY (id);
-- Esta unique es la que hace idempotentes los upsert de validate-guess y skip-attempt.
alter table public.ecos_guesses add constraint ecos_guesses_user_id_game_id_attempt_number_key
  UNIQUE (user_id, game_id, attempt_number);
alter table public.ecos_guesses add constraint ecos_guesses_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES ecos_games(id) ON DELETE CASCADE;
alter table public.ecos_guesses add constraint ecos_guesses_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.ecos_guesses add constraint ecos_guesses_attempt_number_check
  CHECK (((attempt_number >= 1) AND (attempt_number <= 6)));

alter table public.ecos_scores add constraint ecos_scores_pkey PRIMARY KEY (id);
alter table public.ecos_scores add constraint ecos_scores_user_id_game_id_key UNIQUE (user_id, game_id);
alter table public.ecos_scores add constraint ecos_scores_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES ecos_games(id) ON DELETE CASCADE;
alter table public.ecos_scores add constraint ecos_scores_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.ecos_leaderboard add constraint ecos_leaderboard_pkey PRIMARY KEY (user_id);
alter table public.ecos_leaderboard add constraint ecos_leaderboard_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.ecos_reports add constraint ecos_reports_pkey PRIMARY KEY (id);
alter table public.ecos_reports add constraint ecos_reports_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES ecos_games(id);
alter table public.ecos_reports add constraint ecos_reports_song_id_fkey
  FOREIGN KEY (song_id) REFERENCES ecos_songs(id);
alter table public.ecos_reports add constraint ecos_reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.ecos_reports add constraint ecos_reports_reason_check
  CHECK ((reason = ANY (ARRAY['bad_audio'::text, 'wrong_video'::text, 'intro_problem'::text, 'explicit_content'::text, 'other'::text])));
alter table public.ecos_reports add constraint ecos_reports_status_check
  CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'resolved'::text])));

alter table public.ecos_feedback add constraint ecos_feedback_pkey PRIMARY KEY (id);
alter table public.ecos_feedback add constraint ecos_feedback_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.ecos_feedback add constraint ecos_feedback_status_check
  CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text])));
alter table public.ecos_feedback add constraint ecos_feedback_type_check
  CHECK ((type = ANY (ARRAY['bug'::text, 'error'::text, 'suggestion'::text])));

alter table public.ecos_push_subscriptions add constraint ecos_push_subscriptions_pkey PRIMARY KEY (id);
alter table public.ecos_push_subscriptions add constraint ecos_push_subscriptions_user_id_endpoint_key
  UNIQUE (user_id, endpoint);
alter table public.ecos_push_subscriptions add constraint ecos_push_subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.ecos_spotify_playlists add constraint ecos_spotify_playlists_pkey PRIMARY KEY (id);
alter table public.ecos_spotify_playlists add constraint ecos_spotify_playlists_spotify_playlist_id_unique
  UNIQUE (spotify_playlist_id);
alter table public.ecos_spotify_playlists add constraint ecos_spotify_playlists_ingest_mode_check
  CHECK ((ingest_mode = ANY (ARRAY['default'::text, 'all'::text])));

alter table public.ecos_system_logs add constraint ecos_system_logs_pkey PRIMARY KEY (id);
alter table public.ecos_system_logs add constraint ecos_system_logs_job_type_check
  CHECK ((job_type = ANY (ARRAY['ingestion'::text, 'weekly_games'::text, 'daily_game'::text, 'report_auto_deactivate'::text])));
alter table public.ecos_system_logs add constraint ecos_system_logs_status_check
  CHECK ((status = ANY (ARRAY['success'::text, 'partial'::text, 'failure'::text])));

-- ---------------------------------------------------------------------------------------------
-- Índices (los que no crea ya una constraint)
-- ---------------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ecos_games_date ON public.ecos_games USING btree (date DESC);
CREATE INDEX IF NOT EXISTS idx_ecos_guesses_user_game ON public.ecos_guesses USING btree (user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_ecos_leaderboard_points ON public.ecos_leaderboard USING btree (total_points DESC);
CREATE INDEX IF NOT EXISTS idx_ecos_scores_game ON public.ecos_scores USING btree (game_id);
CREATE INDEX IF NOT EXISTS idx_ecos_scores_user ON public.ecos_scores USING btree (user_id);
CREATE INDEX IF NOT EXISTS ecos_songs_fts ON public.ecos_songs
  USING gin (to_tsvector('spanish'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(artist_name, ''::text))));
-- Un único por canción, no por edición. Parcial a propósito: las copias desactivadas conviven
-- con la que se quedó activa, y si algún día se retira una canción por audio malo se puede
-- reingerir otra edición de la misma.
CREATE UNIQUE INDEX IF NOT EXISTS ecos_songs_dedupe_key_activas_key ON public.ecos_songs
  USING btree (dedupe_key) WHERE is_active;
CREATE INDEX IF NOT EXISTS ecos_push_subscriptions_user_id_idx ON public.ecos_push_subscriptions USING btree (user_id);
CREATE INDEX IF NOT EXISTS ecos_push_subscriptions_enabled_idx ON public.ecos_push_subscriptions USING btree (enabled) WHERE (enabled = true);
CREATE INDEX IF NOT EXISTS ecos_spotify_playlists_sort_order_idx ON public.ecos_spotify_playlists USING btree (sort_order);

-- ---------------------------------------------------------------------------------------------
-- Triggers (las funciones están en 02_functions.sql)
-- ---------------------------------------------------------------------------------------------

CREATE TRIGGER ecos_songs_dedupe_key
  BEFORE INSERT OR UPDATE OF title, artist_name ON public.ecos_songs
  FOR EACH ROW EXECUTE FUNCTION ecos_songs_set_dedupe_key();

CREATE TRIGGER ecos_push_subscriptions_updated_at_trigger
  BEFORE UPDATE ON public.ecos_push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION ecos_push_subscriptions_set_updated_at();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.ecos_spotify_playlists
  FOR EACH ROW EXECUTE FUNCTION ecos_set_updated_at();
