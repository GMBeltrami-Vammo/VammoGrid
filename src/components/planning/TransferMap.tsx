import type { HubId, TransferSuggestion } from '@/types/planning';
import { HUBS, HUB_IDS } from '@/constants/planningHubs';
import { fmtInt } from '@/lib/planning/format';

// Static SVG network map of the hub-and-spoke transfer plan. Server component.
// Primary routes (Osasco→spoke): solid brand-blue arrows.
// Fallback spoke-to-spoke routes: dashed amber arrows, slightly curved outward.

const SPOKES: HubId[] = ['mooca', 'sbc'];

const W = 620;
const H = 300;
const PAD = 80;

const coords = HUB_IDS.map((id) => HUBS[id]).filter((h) => h.lat != null && h.lng != null);
const lats = coords.map((h) => h.lat as number);
const lngs = coords.map((h) => h.lng as number);
const minLng = Math.min(...lngs);
const maxLng = Math.max(...lngs);
const maxLat = Math.max(...lats);
const minLat = Math.min(...lats);

function project(h: { lat: number | null; lng: number | null }): { x: number; y: number } {
  const lng = h.lng ?? minLng;
  const lat = h.lat ?? maxLat;
  const x = PAD + ((lng - minLng) / (maxLng - minLng || 1)) * (W - 2 * PAD);
  const y = PAD + ((maxLat - lat) / (maxLat - minLat || 1)) * (H - 2 * PAD);
  return { x, y };
}

// Quadratic bezier control point for spoke-to-spoke arrows: curve away from Osasco.
function spokeCurveControl(p1: { x: number; y: number }, p2: { x: number; y: number }): string {
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const os = project(HUBS.osasco);
  // Offset midpoint away from Osasco by 40px
  const dx = mid.x - os.x;
  const dy = mid.y - os.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const cx = mid.x + (dx / len) * 40;
  const cy = mid.y + (dy / len) * 40;
  return `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;
}

interface RouteInfo {
  from: HubId;
  to: HubId;
  qty: number;
  count: number;
  isSpoke: boolean;
}

export function TransferMap({ transfers }: { transfers: TransferSuggestion[] }) {
  // Aggregate by (fromHub, toHub) route
  const routeMap = new Map<string, RouteInfo>();
  for (const t of transfers) {
    const key = `${t.fromHub}→${t.toHub}`;
    const existing = routeMap.get(key);
    if (existing) {
      existing.qty += t.qty;
      existing.count++;
    } else {
      routeMap.set(key, {
        from: t.fromHub,
        to: t.toHub,
        qty: t.qty,
        count: 1,
        isSpoke: t.fromHub !== 'osasco',
      });
    }
  }

  const routes = Array.from(routeMap.values());
  const maxQty = Math.max(1, ...routes.map((r) => r.qty));

  // Hub totals for the label (what each hub will receive)
  const receiving: Record<HubId, { qty: number; count: number }> = {
    osasco: { qty: 0, count: 0 },
    mooca: { qty: 0, count: 0 },
    sbc: { qty: 0, count: 0 },
  };
  for (const r of routes) {
    receiving[r.to].qty += r.qty;
    receiving[r.to].count += r.count;
  }

  const hubPositions = Object.fromEntries(HUB_IDS.map((id) => [id, project(HUBS[id])])) as Record<HubId, { x: number; y: number }>;

  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Mapa de transferências"
      >
        <defs>
          {/* Fixed-size arrowhead (markerUnits=userSpaceOnUse prevents scaling with strokeWidth) */}
          <marker
            id="arrow-brand"
            markerWidth="10"
            markerHeight="8"
            refX="8"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-brand-500)" />
          </marker>
          <marker
            id="arrow-spoke"
            markerWidth="10"
            markerHeight="8"
            refX="8"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L10,4 L0,8 Z" fill="var(--color-alert-warning, #f59e0b)" />
          </marker>
        </defs>

        {/* Route arrows */}
        {routes.map((r) => {
          const p1 = hubPositions[r.from];
          const p2 = hubPositions[r.to];
          const width = 1 + (r.qty / maxQty) * 3; // 1–4px, never huge
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const key = `${r.from}-${r.to}`;

          if (r.isSpoke) {
            // Spoke-to-spoke: curved dashed amber line
            const d = spokeCurveControl(p1, p2);
            return (
              <g key={key}>
                <path
                  d={d}
                  fill="none"
                  stroke="var(--color-alert-warning, #f59e0b)"
                  strokeOpacity={0.7}
                  strokeWidth={width}
                  strokeDasharray="5 3"
                  markerEnd="url(#arrow-spoke)"
                />
                <text
                  x={mid.x + 10}
                  y={mid.y - 6}
                  textAnchor="middle"
                  style={{ fontSize: 10, fontWeight: 600, fill: 'var(--color-alert-warning, #f59e0b)' }}
                >
                  {fmtInt(r.qty)} un
                </text>
              </g>
            );
          }

          // Osasco→spoke: solid brand line
          return (
            <g key={key}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="var(--color-brand-500)"
                strokeOpacity={r.qty > 0 ? 0.7 : 0.15}
                strokeWidth={r.qty > 0 ? width : 1}
                markerEnd={r.qty > 0 ? 'url(#arrow-brand)' : undefined}
              />
              {r.qty > 0 && (
                <text
                  x={mid.x}
                  y={mid.y - 7}
                  textAnchor="middle"
                  style={{ fontSize: 10, fontWeight: 700, fill: 'var(--color-brand-600, var(--color-brand-500))' }}
                >
                  {fmtInt(r.qty)} un · {r.count} SKU
                </text>
              )}
            </g>
          );
        })}

        {/* If no routes exist, still draw faint Osasco→spoke lines */}
        {routes.length === 0 &&
          SPOKES.map((id) => {
            const p2 = hubPositions[id];
            const p1 = hubPositions.osasco;
            return (
              <line
                key={id}
                x1={p1.x} y1={p1.y}
                x2={p2.x} y2={p2.y}
                stroke="var(--color-brand-500)"
                strokeOpacity={0.12}
                strokeWidth={1}
              />
            );
          })}

        {/* Hub nodes */}
        {HUB_IDS.map((id) => {
          const pos = hubPositions[id];
          const central = HUBS[id].isCentral;
          const recv = receiving[id];
          return (
            <g key={id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={central ? 14 : 10}
                fill={central ? 'var(--color-brand-500)' : 'var(--color-card)'}
                stroke="var(--color-brand-500)"
                strokeWidth={2}
              />
              <text
                x={pos.x}
                y={pos.y + (central ? 28 : 24)}
                textAnchor="middle"
                style={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-foreground)' }}
              >
                {HUBS[id].name}
              </text>
              <text
                x={pos.x}
                y={pos.y + (central ? 41 : 37)}
                textAnchor="middle"
                style={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
              >
                {central ? 'central' : recv.qty > 0 ? `↓ ${fmtInt(recv.qty)} un a receber` : 'sem recebimento'}
              </text>
            </g>
          );
        })}
      </svg>

      {routes.some((r) => r.isSpoke) && (
        <p className="mt-2 text-[11px] text-amber-600">
          ⚠ Transferências tracejadas = rota spoke-to-spoke (Osasco sem estoque disponível para o SKU)
        </p>
      )}
    </div>
  );
}
