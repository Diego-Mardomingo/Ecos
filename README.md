<div align="center">

<div align="center">

<span style="display:inline-flex; align-items:center; gap: 16px;">
  <img src="public/ecos_icon_v2.png" alt="Logo ECOS" width="48" height="48" style="vertical-align:middle;" />
  <span style="font-size:2.35rem; font-weight:800; letter-spacing:1px; line-height:1;">ECOS</span>
</span>

**Adivina la canción del día escuchando solo unos segundos.**  
Música en español y latina · Un reto nuevo cada día para todos

<br>

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=1a1a1a)](https://supabase.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)

</div>

---

## Sobre el proyecto

ECOS es un **proyecto personal** que desarrollo **por afición**: un pequeño juego web para disfrutar de la música, retar el oído y, si te apetece, competir en un ranking con buen rollo. No es un producto comercial; es código y diseño hechos con ganas de aprender y compartir.

---

## Qué puedes hacer en la app

| | |
|:---:|:---|
| **Reto diario** | Cada día, la misma canción para todo el mundo. |
| **Pistas de audio** | Varios intentos; en cada uno escuchas un poco más de la canción. Puedes saltar intentos. |
| **Puntos** | Cuanto antes aciertes, mayor puntuación. |
| **Rankings** | Listado **global**, **semanal** y **mensual**, además **historial** de retos pasados. |
| **Perfil** | Cuenta opcional, estadísticas y cómo te muestras en las tablas. |
| **PWA** | Úsalo en el móvil e **instálalo** como app desde el navegador. |
| **Idiomas** | Interfaz en **español** e **inglés**. |
| **Feedback** | Envía sugerencias o **reporta** si algo no suena bien en un reto. |

---

## Cómo se juega (resumen)

Escribes título o artista y eliges entre las coincidencias. Tienes hasta **seis intentos**; en cada uno el audio crece hasta unos **30 segundos**.

---

## Stack tecnológico

Visión general.

### Núcleo

| Capa | Tecnología |
|------|------------|
| **Framework** | [Next.js](https://nextjs.org) 16 (App Router) · [React](https://react.dev) 19 |
| **Lenguaje** | [TypeScript](https://www.typescriptlang.org) |
| **Backend / datos** | [Supabase](https://supabase.com) — PostgreSQL, autenticación y almacenamiento |
| **Estilos** | [Tailwind CSS](https://tailwindcss.com) v4 · [shadcn/ui](https://ui.shadcn.com) (Radix) |

### Frontend y experiencia

| Área | Herramientas |
|------|----------------|
| **Estado y datos en cliente** | [Zustand](https://github.com/pmndrs/zustand) · [TanStack Query](https://tanstack.com/query) v5 (con persistencia opcional) |
| **Formularios y validación** | [React Hook Form](https://react-hook-form.com) · [Zod](https://zod.dev) |
| **Audio** | [Howler.js](https://howlerjs.com) |
| **Animación** | [Framer Motion](https://www.framer.com/motion/) |
| **Tema** | [next-themes](https://github.com/pacocoursey/next-themes) (claro / oscuro) |
| **i18n** | [next-intl](https://next-intl-docs.vercel.app) |
| **PWA** | [Serwist](https://serwist.pages.dev) (service worker, página offline) |

---

<div align="center">

*Proyecto hobby · Hecho con ❤️, música y código*

</div>
