Run a production build to catch TypeScript and compilation errors before deploying.

```bash
npm run build
```

Also run the type-checker standalone without emitting files:

```bash
npx tsc --noEmit
```

Common failure sources: missing env vars at build time, type errors in `src/types/index.ts`, or broken imports in the `src/lib/metabase/` layer.
