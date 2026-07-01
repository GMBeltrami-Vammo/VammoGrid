// Seed lead times for national (Brazilian) parts, from
// "lead time estimado - pecas nacionais.xlsx". Keyed by sku_base. Everything not
// listed is treated as international (DEFAULT_LEAD_TIME_DAYS = 110). These are the
// initial values; once the dev.fleet_sku_policy table is populated they are
// editable in-app and the ClickHouse value wins.
export const NATIONAL_LEAD_TIMES: Record<string, number> = {
  'VM-07-MOT0-0102': 14,
  'VM-01-ROD0-1007': 14,
  'VM-00-OTH0-0007': 30,
  'VM-01-ROD0-1017': 14,
  'VM-01-PNU0-1001': 21,
  'VM-01-ROD0-1008': 14,
  'VM-00-OTH0-0005': 21,
  'VM-01-MOT0-0102': 14,
  'VM-00-OTH0-0014': 28,
  'VM-01-MOT0-0202': 14,
  'VM-01-PNU0-3001': 21,
  'VM-01-PNU0-0002': 14,
  'VM-01-FRE0-1005': 28,
  'VM-01-MOT0-0103': 14,
  'VM-01-FRE0-3005': 28,
  'VM-01-FRE0-3002': 28,
  'VM-00-OTH0-0011': 30,
};
