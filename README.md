# Forex Vision Pros AI Autopilot

Standalone project. Do not mix with AITuber or Revid projects.

## What this version does
- Forex Vision Pros branded dashboard
- Beginner / Intermediate / Advanced lesson bank
- Optional Gemini script/content generation
- Free-first fallback content when no Gemini key is configured
- Real MP4 vertical video rendering using FFmpeg + Sharp
- Captions/text scenes and branding
- Content library with download/delete
- Basic autopilot setting stored in local JSON
- Health/status endpoint

## Render
Build: `npm install`
Start: `npm start`
Root directory: blank

## Environment variables
`GEMINI_API_KEY` optional. Do not paste the key into chat. Add it in Render Environment.
`GEMINI_MODEL` optional; default is `gemini-2.5-flash-lite`.
`ADMIN_PASSWORD` reserved for the next authentication layer.

## Important free-tier note
Render free instances can sleep and their local filesystem is not a durable database. This starter stores content locally so it is easy to run. For a production autopilot we should add durable storage before relying on long-term history or scheduled publishing.

## Social publishing
YouTube/TikTok/Instagram/Facebook connectors are deliberately not fake. The next stage should use each platform's official OAuth/API flow and respect approval/privacy restrictions.
