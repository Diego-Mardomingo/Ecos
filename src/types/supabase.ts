export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      ecos_feedback: {
        Row: {
          created_at: string
          email: string | null
          id: string
          message: string
          status: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          message: string
          status?: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          status?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ecos_games: {
        Row: {
          created_at: string | null
          date: string
          game_number: number
          id: string
          song_id: string
        }
        Insert: {
          created_at?: string | null
          date: string
          game_number: number
          id?: string
          song_id: string
        }
        Update: {
          created_at?: string | null
          date?: string
          game_number?: number
          id?: string
          song_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecos_games_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "ecos_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      ecos_guesses: {
        Row: {
          attempt_number: number
          correct: boolean
          correct_album: boolean | null
          correct_artist: boolean | null
          created_at: string | null
          game_id: string
          guess_text: string
          id: string
          user_id: string
        }
        Insert: {
          attempt_number: number
          correct?: boolean
          correct_album?: boolean | null
          correct_artist?: boolean | null
          created_at?: string | null
          game_id: string
          guess_text: string
          id?: string
          user_id: string
        }
        Update: {
          attempt_number?: number
          correct?: boolean
          correct_album?: boolean | null
          correct_artist?: boolean | null
          created_at?: string | null
          game_id?: string
          guess_text?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecos_guesses_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "ecos_games"
            referencedColumns: ["id"]
          },
        ]
      }
      ecos_leaderboard: {
        Row: {
          games_played: number
          games_won: number
          global_rank: number | null
          last_played: string | null
          max_streak: number | null
          streak: number
          total_points: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          games_played?: number
          games_won?: number
          global_rank?: number | null
          last_played?: string | null
          max_streak?: number | null
          streak?: number
          total_points?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          games_played?: number
          games_won?: number
          global_rank?: number | null
          last_played?: string | null
          max_streak?: number | null
          streak?: number
          total_points?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ecos_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          notifications_modal_dismiss_count: number
          notifications_modal_shown: boolean
          role: string | null
          show_avatar_in_rankings: boolean
          updated_at: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          notifications_modal_dismiss_count?: number
          notifications_modal_shown?: boolean
          role?: string | null
          show_avatar_in_rankings?: boolean
          updated_at?: string | null
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          notifications_modal_dismiss_count?: number
          notifications_modal_shown?: boolean
          role?: string | null
          show_avatar_in_rankings?: boolean
          updated_at?: string | null
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      ecos_push_subscriptions: {
        Row: {
          created_at: string
          enabled: boolean
          endpoint: string | null
          id: string
          notification_daily_game: boolean
          subscription: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          endpoint?: string | null
          id?: string
          notification_daily_game?: boolean
          subscription: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          endpoint?: string | null
          id?: string
          notification_daily_game?: boolean
          subscription?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ecos_reports: {
        Row: {
          created_at: string | null
          description: string | null
          game_id: string | null
          id: string
          reason: string
          song_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          game_id?: string | null
          id?: string
          reason: string
          song_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          game_id?: string | null
          id?: string
          reason?: string
          song_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecos_reports_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "ecos_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecos_reports_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "ecos_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      ecos_scores: {
        Row: {
          correct: boolean
          created_at: string | null
          game_id: string
          guesses_used: number
          id: string
          points: number
          user_id: string
        }
        Insert: {
          correct?: boolean
          created_at?: string | null
          game_id: string
          guesses_used?: number
          id?: string
          points?: number
          user_id: string
        }
        Update: {
          correct?: boolean
          created_at?: string | null
          game_id?: string
          guesses_used?: number
          id?: string
          points?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecos_scores_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "ecos_games"
            referencedColumns: ["id"]
          },
        ]
      }
      ecos_songs: {
        Row: {
          album_title: string
          artist_name: string
          cover_url: string
          created_at: string | null
          danceability: number | null
          duration_ms: number | null
          energy: number | null
          explicit: boolean | null
          genre: string | null
          id: string
          is_active: boolean | null
          popularity: number | null
          preview_duration_seconds: number | null
          preview_url: string | null
          raw_spotify_data: Json | null
          release_date: string | null
          spotify_id: string | null
          spotify_playlist_id: string | null
          spotify_playlist_name: string | null
          tempo: number | null
          title: string
        }
        Insert: {
          album_title: string
          artist_name: string
          cover_url: string
          created_at?: string | null
          danceability?: number | null
          duration_ms?: number | null
          energy?: number | null
          explicit?: boolean | null
          genre?: string | null
          id?: string
          is_active?: boolean | null
          popularity?: number | null
          preview_duration_seconds?: number | null
          preview_url?: string | null
          raw_spotify_data?: Json | null
          release_date?: string | null
          spotify_id?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_name?: string | null
          tempo?: number | null
          title: string
        }
        Update: {
          album_title?: string
          artist_name?: string
          cover_url?: string
          created_at?: string | null
          danceability?: number | null
          duration_ms?: number | null
          energy?: number | null
          explicit?: boolean | null
          genre?: string | null
          id?: string
          is_active?: boolean | null
          popularity?: number | null
          preview_duration_seconds?: number | null
          preview_url?: string | null
          raw_spotify_data?: Json | null
          release_date?: string | null
          spotify_id?: string | null
          spotify_playlist_id?: string | null
          spotify_playlist_name?: string | null
          tempo?: number | null
          title?: string
        }
        Relationships: []
      }
      ecos_spotify_playlists: {
        Row: {
          created_at: string
          id: string
          ingest_mode: string
          is_active: boolean
          last_ingested_at: string | null
          sort_order: number | null
          source_url: string | null
          spotify_playlist_id: string
          spotify_playlist_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingest_mode?: string
          is_active?: boolean
          last_ingested_at?: string | null
          sort_order?: number | null
          source_url?: string | null
          spotify_playlist_id: string
          spotify_playlist_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingest_mode?: string
          is_active?: boolean
          last_ingested_at?: string | null
          sort_order?: number | null
          source_url?: string | null
          spotify_playlist_id?: string
          spotify_playlist_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ecos_system_logs: {
        Row: {
          details: Json
          duration_ms: number | null
          errors: string[] | null
          id: string
          job_type: string
          ran_at: string | null
          status: string
          summary: string | null
        }
        Insert: {
          details?: Json
          duration_ms?: number | null
          errors?: string[] | null
          id?: string
          job_type: string
          ran_at?: string | null
          status: string
          summary?: string | null
        }
        Update: {
          details?: Json
          duration_ms?: number | null
          errors?: string[] | null
          id?: string
          job_type?: string
          ran_at?: string | null
          status?: string
          summary?: string | null
        }
        Relationships: []
      }
      hubgames_capturas: {
        Row: {
          captura: string
          id_videojuego: number | null
        }
        Insert: {
          captura: string
          id_videojuego?: number | null
        }
        Update: {
          captura?: string
          id_videojuego?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hubgames_capturas_id_videojuego_fkey"
            columns: ["id_videojuego"]
            isOneToOne: false
            referencedRelation: "hubgames_lista_videojuegos_judi"
            referencedColumns: ["id_videojuego"]
          },
        ]
      }
      hubgames_generos: {
        Row: {
          genero: string
        }
        Insert: {
          genero: string
        }
        Update: {
          genero?: string
        }
        Relationships: []
      }
      hubgames_judi_fases_usuario: {
        Row: {
          completado: boolean
          fase1: boolean
          fase2: boolean
          fase3: boolean
          fase4: boolean
          fase5: boolean
          fase6: boolean
          fase7: boolean
          fecha_completado: string | null
          id_lista_judi: number
          id_usuario: string
        }
        Insert: {
          completado?: boolean
          fase1?: boolean
          fase2?: boolean
          fase3?: boolean
          fase4?: boolean
          fase5?: boolean
          fase6?: boolean
          fase7?: boolean
          fecha_completado?: string | null
          id_lista_judi: number
          id_usuario: string
        }
        Update: {
          completado?: boolean
          fase1?: boolean
          fase2?: boolean
          fase3?: boolean
          fase4?: boolean
          fase5?: boolean
          fase6?: boolean
          fase7?: boolean
          fecha_completado?: string | null
          id_lista_judi?: number
          id_usuario?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubgames_judi_fases_usuario_id_lista_judi_fkey"
            columns: ["id_lista_judi"]
            isOneToOne: false
            referencedRelation: "hubgames_lista_videojuegos_judi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubgames_judi_fases_usuario_id_usuario_fkey"
            columns: ["id_usuario"]
            isOneToOne: false
            referencedRelation: "hubgames_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      hubgames_judi_generacion_logs: {
        Row: {
          error_mensaje: string | null
          error_stack: string | null
          exito: boolean
          fecha_ejecucion: string | null
          fecha_judi: string | null
          fuente: string | null
          id: number
          id_juego_rawg: number | null
          id_juego_steam: number | null
          nombre_juego: string | null
        }
        Insert: {
          error_mensaje?: string | null
          error_stack?: string | null
          exito: boolean
          fecha_ejecucion?: string | null
          fecha_judi?: string | null
          fuente?: string | null
          id?: number
          id_juego_rawg?: number | null
          id_juego_steam?: number | null
          nombre_juego?: string | null
        }
        Update: {
          error_mensaje?: string | null
          error_stack?: string | null
          exito?: boolean
          fecha_ejecucion?: string | null
          fecha_judi?: string | null
          fuente?: string | null
          id?: number
          id_juego_rawg?: number | null
          id_juego_steam?: number | null
          nombre_juego?: string | null
        }
        Relationships: []
      }
      hubgames_judi_intentos: {
        Row: {
          created_at: string | null
          id: number
          id_lista_judi: number
          id_usuario: string
          intento: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          id_lista_judi: number
          id_usuario: string
          intento: string
        }
        Update: {
          created_at?: string | null
          id?: number
          id_lista_judi?: number
          id_usuario?: string
          intento?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubgames_judi_intentos_id_lista_judi_fkey"
            columns: ["id_lista_judi"]
            isOneToOne: false
            referencedRelation: "hubgames_lista_videojuegos_judi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hubgames_judi_intentos_id_usuario_fkey"
            columns: ["id_usuario"]
            isOneToOne: false
            referencedRelation: "hubgames_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      hubgames_judi_pool: {
        Row: {
          created_at: string
          discarded: boolean
          discarded_reason: string | null
          eligibility_reasons: string[] | null
          filter_metadata_complete_pass: boolean
          filter_positive_score_pass: boolean
          filter_reviews_min_pass: boolean
          filter_screenshots_pass: boolean
          game_name: string
          id: number
          is_eligible: boolean
          relevance_score: number
          selected_daily_date: string | null
          selected_daily_list_id: number | null
          selected_for_daily: boolean
          source_tag: string
          steam_appid: number
          updated_at: string
          week_end_date: string
          week_start_date: string
        }
        Insert: {
          created_at?: string
          discarded?: boolean
          discarded_reason?: string | null
          eligibility_reasons?: string[] | null
          filter_metadata_complete_pass?: boolean
          filter_positive_score_pass?: boolean
          filter_reviews_min_pass?: boolean
          filter_screenshots_pass?: boolean
          game_name: string
          id?: number
          is_eligible?: boolean
          relevance_score?: number
          selected_daily_date?: string | null
          selected_daily_list_id?: number | null
          selected_for_daily?: boolean
          source_tag?: string
          steam_appid: number
          updated_at?: string
          week_end_date: string
          week_start_date: string
        }
        Update: {
          created_at?: string
          discarded?: boolean
          discarded_reason?: string | null
          eligibility_reasons?: string[] | null
          filter_metadata_complete_pass?: boolean
          filter_positive_score_pass?: boolean
          filter_reviews_min_pass?: boolean
          filter_screenshots_pass?: boolean
          game_name?: string
          id?: number
          is_eligible?: boolean
          relevance_score?: number
          selected_daily_date?: string | null
          selected_daily_list_id?: number | null
          selected_for_daily?: boolean
          source_tag?: string
          steam_appid?: number
          updated_at?: string
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubgames_judi_pool_steam_appid_fkey"
            columns: ["steam_appid"]
            isOneToOne: false
            referencedRelation: "hubgames_juegos_steam"
            referencedColumns: ["steam_appid"]
          },
        ]
      }
      hubgames_juegos_steam: {
        Row: {
          about_the_game: string | null
          achievements_total: number | null
          background: string | null
          background_raw: string | null
          capsule_image: string | null
          capsule_imagev5: string | null
          categories: Json | null
          coming_soon: boolean | null
          created_at: string | null
          detailed_description: string | null
          developers: string[] | null
          genres: Json | null
          header_image: string | null
          is_free: boolean | null
          last_synced_at: string | null
          metacritic_score: number | null
          metacritic_url: string | null
          movies: Json | null
          name: string
          packages: Json | null
          platforms: Json | null
          price_overview: Json | null
          publishers: string[] | null
          recommendations_total: number | null
          release_date: string | null
          release_date_text: string | null
          required_age: number | null
          screenshots: Json | null
          short_description: string | null
          source_priority: number | null
          steam_appid: number
          steam_store_raw: Json | null
          steam_web_raw: Json | null
          steamspy_average_2weeks: number | null
          steamspy_average_forever: number | null
          steamspy_ccu: number | null
          steamspy_median_2weeks: number | null
          steamspy_median_forever: number | null
          steamspy_negative: number | null
          steamspy_owners: string | null
          steamspy_positive: number | null
          steamspy_raw: Json | null
          steamspy_score_rank: number | null
          steamspy_tags: Json | null
          steamspy_userscore: number | null
          supported_languages: string | null
          type: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          about_the_game?: string | null
          achievements_total?: number | null
          background?: string | null
          background_raw?: string | null
          capsule_image?: string | null
          capsule_imagev5?: string | null
          categories?: Json | null
          coming_soon?: boolean | null
          created_at?: string | null
          detailed_description?: string | null
          developers?: string[] | null
          genres?: Json | null
          header_image?: string | null
          is_free?: boolean | null
          last_synced_at?: string | null
          metacritic_score?: number | null
          metacritic_url?: string | null
          movies?: Json | null
          name: string
          packages?: Json | null
          platforms?: Json | null
          price_overview?: Json | null
          publishers?: string[] | null
          recommendations_total?: number | null
          release_date?: string | null
          release_date_text?: string | null
          required_age?: number | null
          screenshots?: Json | null
          short_description?: string | null
          source_priority?: number | null
          steam_appid: number
          steam_store_raw?: Json | null
          steam_web_raw?: Json | null
          steamspy_average_2weeks?: number | null
          steamspy_average_forever?: number | null
          steamspy_ccu?: number | null
          steamspy_median_2weeks?: number | null
          steamspy_median_forever?: number | null
          steamspy_negative?: number | null
          steamspy_owners?: string | null
          steamspy_positive?: number | null
          steamspy_raw?: Json | null
          steamspy_score_rank?: number | null
          steamspy_tags?: Json | null
          steamspy_userscore?: number | null
          supported_languages?: string | null
          type?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          about_the_game?: string | null
          achievements_total?: number | null
          background?: string | null
          background_raw?: string | null
          capsule_image?: string | null
          capsule_imagev5?: string | null
          categories?: Json | null
          coming_soon?: boolean | null
          created_at?: string | null
          detailed_description?: string | null
          developers?: string[] | null
          genres?: Json | null
          header_image?: string | null
          is_free?: boolean | null
          last_synced_at?: string | null
          metacritic_score?: number | null
          metacritic_url?: string | null
          movies?: Json | null
          name?: string
          packages?: Json | null
          platforms?: Json | null
          price_overview?: Json | null
          publishers?: string[] | null
          recommendations_total?: number | null
          release_date?: string | null
          release_date_text?: string | null
          required_age?: number | null
          screenshots?: Json | null
          short_description?: string | null
          source_priority?: number | null
          steam_appid?: number
          steam_store_raw?: Json | null
          steam_web_raw?: Json | null
          steamspy_average_2weeks?: number | null
          steamspy_average_forever?: number | null
          steamspy_ccu?: number | null
          steamspy_median_2weeks?: number | null
          steamspy_median_forever?: number | null
          steamspy_negative?: number | null
          steamspy_owners?: string | null
          steamspy_positive?: number | null
          steamspy_raw?: Json | null
          steamspy_score_rank?: number | null
          steamspy_tags?: Json | null
          steamspy_userscore?: number | null
          supported_languages?: string | null
          type?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      hubgames_lista_videojuegos_judi: {
        Row: {
          calificacion: number
          data_source: string
          desarrollador: string
          fecha: string
          id: number
          id_videojuego: number
          nombre: string
          released: string
          steam_appid: number | null
        }
        Insert: {
          calificacion: number
          data_source?: string
          desarrollador: string
          fecha: string
          id?: number
          id_videojuego: number
          nombre: string
          released: string
          steam_appid?: number | null
        }
        Update: {
          calificacion?: number
          data_source?: string
          desarrollador?: string
          fecha?: string
          id?: number
          id_videojuego?: number
          nombre?: string
          released?: string
          steam_appid?: number | null
        }
        Relationships: []
      }
      hubgames_plataformas: {
        Row: {
          plataforma: string
        }
        Insert: {
          plataforma: string
        }
        Update: {
          plataforma?: string
        }
        Relationships: []
      }
      hubgames_push_subscriptions: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          subscription: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          subscription: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          subscription?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hubgames_usuarios: {
        Row: {
          administrador: boolean
          cuenta_google: boolean
          email: string
          email_verificado: boolean
          fecha_creacion: string
          id: string
          password_hash: string | null
          username: string
        }
        Insert: {
          administrador?: boolean
          cuenta_google?: boolean
          email: string
          email_verificado?: boolean
          fecha_creacion?: string
          id?: string
          password_hash?: string | null
          username: string
        }
        Update: {
          administrador?: boolean
          cuenta_google?: boolean
          email?: string
          email_verificado?: boolean
          fecha_creacion?: string
          id?: string
          password_hash?: string | null
          username?: string
        }
        Relationships: []
      }
      hubgames_videojuego_genero: {
        Row: {
          genero: string
          id_videojuego: number
        }
        Insert: {
          genero: string
          id_videojuego: number
        }
        Update: {
          genero?: string
          id_videojuego?: number
        }
        Relationships: [
          {
            foreignKeyName: "hubgames_videojuego_genero_genero_fkey"
            columns: ["genero"]
            isOneToOne: false
            referencedRelation: "hubgames_generos"
            referencedColumns: ["genero"]
          },
          {
            foreignKeyName: "hubgames_videojuego_genero_id_videojuego_fkey"
            columns: ["id_videojuego"]
            isOneToOne: false
            referencedRelation: "hubgames_lista_videojuegos_judi"
            referencedColumns: ["id_videojuego"]
          },
        ]
      }
      hubgames_videojuego_plataforma: {
        Row: {
          id_videojuego: number
          plataforma: string
        }
        Insert: {
          id_videojuego: number
          plataforma: string
        }
        Update: {
          id_videojuego?: number
          plataforma?: string
        }
        Relationships: [
          {
            foreignKeyName: "hubgames_videojuego_plataforma_id_videojuego_fkey"
            columns: ["id_videojuego"]
            isOneToOne: false
            referencedRelation: "hubgames_lista_videojuegos_judi"
            referencedColumns: ["id_videojuego"]
          },
          {
            foreignKeyName: "hubgames_videojuego_plataforma_plataforma_fkey"
            columns: ["plataforma"]
            isOneToOne: false
            referencedRelation: "hubgames_plataformas"
            referencedColumns: ["plataforma"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ecos_finalize_game_score: {
        Args: {
          p_correct: boolean
          p_game_id: string
          p_guesses_used: number
          p_points: number
          p_streak: number
          p_update_streak: boolean
          p_user_id: string
          p_won: boolean
        }
        Returns: undefined
      }
      ecos_guess_and_finalize_score: {
        Args: {
          p_attempt_number: number
          p_correct: boolean
          p_correct_album: boolean
          p_correct_artist: boolean
          p_game_id: string
          p_guess_text: string
          p_guesses_used: number
          p_points: number
          p_streak: number
          p_update_streak: boolean
          p_user_id: string
          p_won: boolean
        }
        Returns: undefined
      }
      ecos_search_songs: {
        Args: { p_limit: number; p_query: string }
        Returns: {
          album_title: string
          artist_name: string
          cover_url: string
          created_at: string | null
          danceability: number | null
          duration_ms: number | null
          energy: number | null
          explicit: boolean | null
          genre: string | null
          id: string
          is_active: boolean | null
          popularity: number | null
          preview_duration_seconds: number | null
          preview_url: string | null
          raw_spotify_data: Json | null
          release_date: string | null
          spotify_id: string | null
          spotify_playlist_id: string | null
          spotify_playlist_name: string | null
          tempo: number | null
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ecos_songs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ecos_update_leaderboard:
        | {
            Args: {
              p_points: number
              p_streak: number
              p_user_id: string
              p_won: boolean
            }
            Returns: undefined
          }
        | {
            Args: {
              p_points: number
              p_streak: number
              p_update_streak?: boolean
              p_user_id: string
              p_won: boolean
            }
            Returns: undefined
          }
      get_leaderboard_by_period: {
        Args: {
          p_limit?: number
          p_period?: string
          p_reference_date?: string
          p_search?: string
        }
        Returns: {
          aciertos: number
          avatar_url: string
          display_name: string
          global_rank: number
          streak: number
          total_points: number
          user_id: string
        }[]
      }
      get_leaderboard_period_summaries: {
        Args: { p_count?: number; p_granularity: string }
        Returns: {
          period_end: string
          period_start: string
          winner_avatar_url: string
          winner_display_name: string
          winner_points: number
          winner_user_id: string
        }[]
      }
      get_user_avg_guesses: { Args: { p_user_id: string }; Returns: number }
      get_user_ranking_stats: {
        Args: { p_user_id: string }
        Returns: {
          games_played: number
          games_won: number
          global_rank: number
          max_streak: number
          monthly_aciertos: number
          monthly_points: number
          monthly_rank: number
          streak: number
          total_points: number
          weekly_aciertos: number
          weekly_points: number
          weekly_rank: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      run_daily_game_selector_at_midnight_spain: {
        Args: never
        Returns: undefined
      }
      run_judi_daily_notification: { Args: never; Returns: undefined }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
