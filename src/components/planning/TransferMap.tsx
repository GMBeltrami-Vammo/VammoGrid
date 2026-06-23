import type { HubId, TransferSuggestion } from '@/types/planning';
import { HUBS, HUB_IDS } from '@/constants/planningHubs';
import { fmtInt } from '@/lib/planning/format';

// Static SVG network map of the hub-and-spoke transfer plan. Server component (no
// hooks, no extra deps): projects hub lat/lng to the viewBox and draws Osasco→spoke
// arrows sized by total transferred quantity.

const W = 620;
const H = 320;
const PAD = 70;

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

export function TransferMap({ transfers }: { transfers: TransferSuggestion[] }) {
  const totals: Record<HubId, { qty: number; count: number }> = {
    osasco: { qty: 0, count: 0 },
    mooca: { qty: 0, count: 0 },
    sbc: { qty: 0, count: 0 },
  };
  for (const t of transfers) {
    totals[t.toHub].qty += t.qty;
    totals[t.toHub].count++;
  }
  const maxQty = Math.max(1, ...HUB_IDS.map((h) => totals[h].qty));
  const osascoPos = project(HUBS.osasco);

  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Mapa de transferências">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-brand-500)" />
          </marker>
        </defs>

        {HUB_IDS.filter((id) => !HUBS[id].isCentral).map((id) => {
          const pos = project(HUBS[id]);
          const qty = totals[id].qty;
          const width = 1.5 + (qty / maxQty) * 9;
          return (
            <g key={id}>
              <line
                x1={osascoPos.x}
                y1={osascoPos.y}
                x2={pos.x}
                y2={pos.y}
                stroke="var(--color-brand-500)"
                strokeOpacity={qty > 0 ? 0.7 : 0.15}
                strokeWidth={qty > 0 ? width : 1.5}
                markerEnd={qty > 0 ? 'url(#arrow)' : undefined}
              />
              {qty > 0 && (
                <text
                  x={(osascoPos.x + pos.x) / 2}
                  y={(osascoPos.y + pos.y) / 2 - 6}
                  textAnchor="middle"
                  className="fill-brand-600"
                  style={{ fontSize: 11, fontWeight: 700 }}
                >
                  {fmtInt(qty)} un · {totals[id].count} SKU
                </text>
              )}
            </g>
          );
        })}

        {HUB_IDS.map((id) => {
          const pos = project(HUBS[id]);
          const central = HUBS[id].isCentral;
          return (
            <g key={id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={central ? 16 : 11}
                fill={central ? 'var(--color-brand-500)' : 'var(--color-card)'}
                stroke="var(--color-brand-500)"
                strokeWidth={2}
              />
              <text
                x={pos.x}
                y={pos.y + (central ? 32 : 26)}
                textAnchor="middle"
                className="fill-foreground"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                {HUBS[id].name}
              </text>
              <text
                x={pos.x}
                y={pos.y + (central ? 46 : 40)}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 10 }}
              >
                {central ? 'central' : `${fmtInt(totals[id].qty)} un a receber`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
