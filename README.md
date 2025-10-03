# Vercel Quran & Sunnah API

Serverless Node API ready for Vercel.

Endpoints:
- GET /api/quran/surahs — Quran surah metadata (AlQuran Cloud API)
- GET /api/sunnah — Sunnah sample items (optional ?collection=Bukhari)

Local dev:
1. npm i
2. npx vercel dev

Deploy:
1. npx vercel

Notes:
- Caching: s-maxage=3600, stale-while-revalidate=86400
- Node runtime: 18 (see vercel.json)
