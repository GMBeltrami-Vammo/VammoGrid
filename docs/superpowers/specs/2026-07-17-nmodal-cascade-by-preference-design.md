# N-modal cascade by preference — design

Date: 2026-07-17.
Status: approved (user said "Do it").

## Problem

The Projeção Global simulation only exposed marítimo/aéreo leads (legacy binary framing),
and the "combinado" scenario picked a modal per breach with a global floor and a
targetDoi-based order size. The user wants:

- Aéreo & Marítimo to be first-class modais, uniform with Courier (no legacy sea/air special case).
- Coverage target expressed **per modal**, as two numbers: **piso (DOH mín) + cadência (dias)**.
- The elaboration to be a **preference-ordered cascade**: cover as much as possible with the
  1st-preference modal; whatever it can't reach in time cascades to the 2nd, then 3rd…
  Preference = **longest lead → shortest** (the slow/cheap modal does the bulk; faster ones
  only bridge the near-term gap it can't reach in time).
- **frequency = cobertura**: each modal reorders on a cadence tied to its cadência.
- Lead editable **only in the simulation** (never changes a real order's ETA).

## Decisions (locked via AskUserQuestion)

1. **Per-modal piso/cadência = simulation-only (ephemeral).** Nothing persisted on the modal
   (decision #22 stands). Outside the sim, every modal uses the global criteria piso + a
   default cadence.
2. **One canonical cascade** shared in substance by Projeção Global's *combinado* and Novo
   Pedido: the shared `ModalPlan { minDoh, cadenceDays }` + the preference rule (slowest/cheapest
   sustains the bulk order-up-to `piso + cadência`; faster lanes bridge the gap they can reach).
3. **Two params per modal: piso (DOH mín) + cadência (dias).**

## Design

### Engine (`weekgrid.ts`) — `whenNeededInjection` becomes the recurring cascade

Every non-baseline scenario runs the same recurring when-needed loop, sizing each order
**order-up-to `(piso + cadência) × taxa`** at the arrival day and choosing the lane by
preference:

- **Modal scenario "X"**: the lane is fixed to X (skip the SKU if its supplier lacks X → baseline).
- **Combinado**: per breach, pick the **slowest lane that still arrives ≤ the breach** (preference
  longest-first), else the fastest (late). This is the cascade: the slow/cheap modal carries the
  far horizon; faster modais cover the near-term breaches it can't reach in time.
- Breach detection floor = the **max piso** among the scenario's enabled lanes.
- Arrival = `lead ≤ breach ? breach : lead` (land at the breach if the lead allows, else ASAP).

Per-modal `{piso, cadência}` come from an optional `planByModal` override (the sim); otherwise
the global criteria piso + a `DEFAULT_CADENCE_DAYS` (30).

`buildAllScenarioGrids` takes `planByModal?: Record<modalName, {minDoh?; cadenceDays?}>` (replaces
`floorByScenario`). Cell coloring floor: a modal scenario colors with its own piso; baseline &
combinado color with the global criteria floor.

Novo Pedido keeps using `suggestQuantities` (the one-shot form of the same `ModalPlan` cascade —
order now, arrivals at lead offsets). The two forms differ only by one-shot vs recurring anchoring,
which is inherent to "place a pedido now" vs "project buying when needed"; they share the
`ModalPlan` params + the longest-first preference.

### Simulation panel (`WeekGridView`)

Per (fornecedor × modal): **lead** (already). Per modal (global, ephemeral): **piso (DOH mín)** +
**cadência (dias)** (new). Aéreo/Marítimo already listed uniformly with Courier. `simulateWeekGrids`
takes `planByModal` and threads it to `buildAllScenarioGrids`.

### Out of scope (YAGNI)

Nothing persisted on the modal cadastro. Preference stays fixed at longest→shortest (no manual
reordering yet). The per-modal isolated scenarios keep their meaning.

## Verification

- Regenerate the characterization snapshot (combinado + per-modal sizing change deliberately).
- Behavioral tests hold: combinado picks the slowest-in-time lane at the first breach (Aéreo, not
  Courier); a per-modal scenario injects via that modal; a SKU lacking the modal stays at baseline;
  baseline never suggests. Add: order size follows `(piso+cadência)×taxa`.
