Start the Next.js development server.

```bash
npm run dev
```

The app runs at http://localhost:3000. Auth.js will redirect unauthenticated users to `/login` (Google OAuth, restricted to @vammo.com). To bypass auth locally, ensure `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` are set in `.env.local`.
