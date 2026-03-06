# 🎵 Ecos 

> Adivina canciones escuchando fragmentos de audio. Una nueva canción cada día.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?logo=supabase)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://typescriptlang.org)

---

## ✨ Qué ofrece

- 🎧 **Fragmentos progresivos** — Escucha pistas de 1s hasta 30s en 6 intentos
- 📅 **Una canción al día** — Estilo Wordle, mismo reto para todos
- 🏆 **Ranking global** — Compite con otros jugadores en tiempo real
- 🔥 **Rachas diarias** — Bonus por días consecutivos jugados
- 📱 **PWA instalable** — Juega desde tu móvil como app nativa
- 🌐 **Multiidioma** — Soporte i18n con next-intl

---

## 🎮 Mecánica

Máximo 6 intentos para adivinar. Cada intento desbloquea un fragmento más largo de audio. La puntuación es inversa: acertar pronto da más puntos. El servidor valida las respuestas para evitar trampas.

---

## 🛠 Stack

| Categoría     | Tecnología                    |
|---------------|-------------------------------|
| Framework     | Next.js 16 (App Router)       |
| Base de datos | Supabase (PostgreSQL)         |
| UI            | Tailwind CSS v4 + shadcn/ui   |
| Estado        | Zustand + TanStack Query      |
| Audio         | Howler.js + API de Deezer     |
| Animaciones   | Framer Motion                 |
