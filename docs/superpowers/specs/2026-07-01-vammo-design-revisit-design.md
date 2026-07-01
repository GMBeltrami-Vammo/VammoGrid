# VammoGrid — Design Revisit (Vammo DS 2026 alignment)

## Context

VammoGrid is a Next.js 16 App Router app.
It runs on Tailwind v4 + shadcn/ui primitives (Base UI under the hood).
It is **Product track** per the `vammo-design` skill: restrained grayscale base, blue accent, no marketing flourish (no Zimmzag, no Vamminho, no hero typography).

The `vammo-design` skill was updated with the 2026 mini-rebranding guidance.
Blue (`#2EC2FF`) is now primary, alongside Black and White.
Yellow/Pink/Orange are restricted to semantic alerts only.

`globals.css` already implements most of this: blue-primary tokens, a 4-level dark elevation system, and the exception alert palette (success/error/warning/info) at the DS-specified hex values.
The gap is narrower than "redo the design" — it is a token-and-component alignment pass.

Scope for this revisit, per user decision: **Foundation + component polish**.
Align typography, radius, and shared components to the DS.
No page-layout or information-density rework (that would be a larger, separate project).

## Audit findings (what's off-brand or broken today)

1. **Font is not actually Geist — it's nothing.**
   `globals.css:36` defines `--font-sans: var(--font-sans)`, which is self-referential.
   `layout.tsx` defines `--font-geist-sans` via `next/font`, but nothing maps `--font-sans` to it.
   The `font-sans` utility (applied on `<html>`) currently resolves to an invalid custom property and silently falls back to the browser's default font stack.
   This is a real bug, not just an off-brand font choice.
   DS says Product track = **Inter**.
   Fixing the wiring and swapping to Inter solves both at once.

2. **Radius doesn't match the DS's explicit system.**
   DS: inputs/buttons **8px**, cards **12px**, sheet tops **16px**, pills reserved for chips/avatars only.
   Current tokens: `--radius: 0.625rem` (10px) base, with `--radius-lg` (buttons/inputs) = 10px and `--radius-xl` (cards) = 14px.
   Close, not exact. Badges already correctly use `rounded-4xl` (pill) — that part is compliant.

3. **Chart colors are already blue-scale + neutral** (`--chart-1..5` map to the blue tonal scale + grays) — compliant, no change needed there, just confirm no stray non-semantic neon creeps into any chart series.

4. **A few Unicode glyphs in place of icons**, which reads as decorative/emoji-adjacent — DS says no emoji in product UI:
   - `♻` (recovery) and `⚑` (buy-by marker) in `WeekGridView.tsx`'s legend.
   Directional `→` in transfer routes (`Osasco → Mooca`) is fine — DS explicitly allows Unicode arrows.

5. **Motion is ad-hoc** (`transition-colors`, `transition-all` scattered per-component) with no shared duration/easing tokens.
   DS specifies 120/200/320ms with `ease-snap`/`ease-standard`, no bounce.
   Not currently violated (nothing bounces), just not standardized.

6. **Everything else already matches**: blue accent as default, tabular-nums on figure columns, uppercase-tracked eyebrows, pt-BR sentence-case UI copy, no Vamminho, no gradients/glassmorphism, exception alert palette at correct hex values, dark-mode elevation system.

## Approach

**Token-first.** Fix the shared tokens in `globals.css` (font, radius) so every shadcn primitive that already consumes `--radius-lg`/`--radius-xl`/font-sans updates automatically, with zero markup changes in `button.tsx`/`input.tsx`/`card.tsx`.
Then make small, targeted component edits only where tokens can't reach: the two emoji-glyphs, and adding the motion-token utilities where ad-hoc transitions exist.

Rejected alternatives:
- **Component-by-component rewrite** — more control, much more churn, and the tokens already carry 90% of the DS system. Not justified for a polish-scope pass.
- **Adopt `@leopardaelectric/vammo-ui`** — the DS's canonical Product-track library, but a full migration off shadcn is a different, much larger project and unproven against this Next 16 / Base UI stack. Flagged as a future decision, out of scope here.

**Light mode**: keep it. It is a pure CSS-variable swap (`.dark` class toggle + one `localStorage` read before paint) — no runtime cost, so there's no performance reason to drop it.

## Design

### 1. Typography

- Replace `Geist`/`Geist_Mono` imports in `layout.tsx` with `Inter` (`next/font/google`, weights 300/400/500/700 to match DS Light/Regular/Medium/Bold), variable name `--font-inter`.
- Fix `globals.css`: `--font-sans: var(--font-inter)` (was self-referential). Keep `Geist_Mono` as-is for the formula/code boxes (`Fontes & Fórmulas`, lineage `<pre>` blocks) — DS doesn't govern the mono face, and it's already correctly wired (`--font-mono: var(--font-geist-mono)`), so no change needed there.
- No component changes needed — every text element already inherits `font-sans` from `body`/`html`.

### 2. Radius

Redefine the radius scale in `globals.css` to the DS's exact px values, replacing the multiplier-of-`--radius` formula with fixed values:

| Token | New value | Used by (unchanged markup) |
|---|---|---|
| `--radius-md` | 8px | small button/icon variants (`rounded-[min(var(--radius-md),Npx)]`) |
| `--radius-lg` | 8px | default buttons, inputs (`rounded-lg`) |
| `--radius-xl` | 12px | cards (`rounded-xl`) |
| `--radius-2xl` | 16px | any sheet/dialog-top usage (`rounded-2xl`), if present |
| `--radius-sm` | 6px | small chips/nested elements |

Pills (badges, `StatusPill`/`RiskPill`/`SeverityPill`/`LatePill` in `components/planning/ui.tsx`) already use `rounded-full`/`rounded-4xl` — no change, this is the DS-correct pattern (pills reserved for chips/avatars).

### 3. Motion tokens

Add to `globals.css` `@theme`:
```
--duration-snap: 120ms;
--duration-standard: 200ms;
--duration-slow: 320ms;
--ease-snap: cubic-bezier(0.2, 0, 0, 1);
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
```
Apply `duration-(--duration-standard) ease-(--ease-standard)` (Tailwind v4 arbitrary-token syntax) in place of bare `transition-colors`/`transition-all` on the handful of interactive components that currently hardcode timing (sidebar nav links, tab/scope toggles, theme toggle). This is a mechanical find-and-replace, not a redesign — no visual change in feel, just a named, consistent source.

### 4. Emoji/glyph cleanup

In `WeekGridView.tsx`'s legend:
- `♻` → `lucide-react` `Recycle` icon, sized to match adjacent text (14–16px), `currentColor`.
- `⚑` → `lucide-react` `Flag` icon, same treatment.
Both already sit next to text labels in the legend, so this is a straight glyph→icon swap with no layout change.

### 5. Verification

- Visual: load every top-level page (Visão Geral, Estoque, Compras, Transferências, Semanas, Pedidos, Lead times, Fontes & Fórmulas, Guia, Alertas, Compatibilidade, SKUs) in both light and dark mode; confirm font actually renders as Inter (previously silently falling back — easy to verify via DevTools computed style), radius reads as 8/12px, no emoji-glyphs remain, motion still feels identical (no jank, no new bounce).
- `npx tsc --noEmit` + `npm run build` clean, as usual.
- No test changes expected — this is styling-only, no logic touched.

## Out of scope (explicitly deferred)

- Page layout / information density rework.
- Adopting `@leopardaelectric/vammo-ui`.
- Any Brand-track flourish (Zimmzag, Supria Sans, marketing typography) — VammoGrid stays Product track throughout.
- Official Vammo icon set swap (Bold/Light 8pt/4pt families) — DS itself flags this as a known substitution (Lucide) pending the Figma source; not something to chase here.
