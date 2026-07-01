// The default visible SKU universe (sub-project A, decisions.MD #11 / order-orchestration spec).
//
// These are the 139 unique SKU codes present in the reference planning tool
// ("Spare Parts Bike - June.html" — Pablo's "Days on Hand v100"). The app defaults
// every analysis (stock, DOH, projections, procurement) to this set; the full
// catalog stays reachable via the "Lista completa" tab (?ignoreSkuSelection=true).
//
// Extracted from the tool's embedded DATA.skus[].sku, keeping only VM-* codes: the
// export contained one corrupted row whose `sku` held an item name ("Parafuso da
// pinça diantei…") instead of a code — that part already exists as its clean row
// VM-01-FRE0-1016, so dropping the corrupt entry leaves 139 unique, not 140.
//
// This is the SEED only. Once dev.fleet_sku_scope is populated it is editable
// in-app (add/remove SKUs from scope) and the table wins; this list is just the
// one-time initial population.

export const SCOPE_SEED_SKUS: readonly string[] = [
  'VM-01-ACS0-0002', 'VM-01-ACS0-0003', 'VM-01-ACS0-0101', 'VM-01-ACS0-0102',
  'VM-01-ACS0-0201', 'VM-01-ACS0-0202', 'VM-01-ACS0-0204', 'VM-01-ACS0-3501',
  'VM-01-ACS0-3503', 'VM-01-ACS0-4406', 'VM-01-CAR0-1101', 'VM-01-CAR0-1201',
  'VM-01-CAR0-1301', 'VM-01-CAR0-1402', 'VM-01-CAR0-1501', 'VM-01-CAR0-2101',
  'VM-01-CAR0-2102', 'VM-01-CAR0-2201', 'VM-01-CAR0-2202', 'VM-01-CAR0-2501',
  'VM-01-CAR0-2502', 'VM-01-CAR0-2503', 'VM-01-CAR0-3102', 'VM-01-CAR0-3202',
  'VM-01-CAR0-3301', 'VM-01-CAR0-3501', 'VM-01-CAR0-4401', 'VM-01-CAR0-4501',
  'VM-01-CARA-1101', 'VM-01-CARA-1201', 'VM-01-CARA-1401', 'VM-01-CARA-3101',
  'VM-01-CARA-3201', 'VM-01-CARP-1502', 'VM-01-DIR0-0001', 'VM-01-DIR0-0002',
  'VM-01-DIR0-0003', 'VM-01-DIR0-0005', 'VM-01-DIR0-0007', 'VM-01-ELE0-0002',
  'VM-01-ELE0-0003', 'VM-01-ELE0-0004', 'VM-01-ELE0-0006', 'VM-01-ELE0-0007',
  'VM-01-ELE0-0008', 'VM-01-ELE0-0010', 'VM-01-ELE0-0011', 'VM-01-ELE0-0012',
  'VM-01-ELE0-0013', 'VM-01-FRE0-0002', 'VM-01-FRE0-1001', 'VM-01-FRE0-1006',
  'VM-01-FRE0-1010', 'VM-01-FRE0-1011', 'VM-01-FRE0-1012', 'VM-01-FRE0-1013',
  'VM-01-FRE0-1014', 'VM-01-FRE0-1015', 'VM-01-FRE0-1016', 'VM-01-FRE0-1101',
  'VM-01-FRE0-1102', 'VM-01-FRE0-1108', 'VM-01-FRE0-1201', 'VM-01-FRE0-1202',
  'VM-01-FRE0-1208', 'VM-01-FRE0-2006', 'VM-01-FRE0-2014', 'VM-01-FRE0-2015',
  'VM-01-FRE0-3001', 'VM-01-ILU0-0001', 'VM-01-ILU0-0002', 'VM-01-ILU0-1001',
  'VM-01-ILU0-3101', 'VM-01-ILU0-3201', 'VM-01-ILU0-3501', 'VM-01-ILU0-3502',
  'VM-01-IOT0-0001', 'VM-01-IOT0-0002', 'VM-01-IOT0-0003', 'VM-01-MOT0-0001',
  'VM-01-MOT0-0101', 'VM-01-OTH0-0002', 'VM-01-OTH0-0101', 'VM-01-OTH0-0201',
  'VM-01-OTH0-3002', 'VM-01-OTH0-3301', 'VM-01-OTH0-3501', 'VM-01-OTH0-3504',
  'VM-01-OTH0-3505', 'VM-01-OTH0-4405', 'VM-01-ROD0-1001', 'VM-01-ROD0-1003',
  'VM-01-ROD0-1004', 'VM-01-ROD0-3001', 'VM-01-SUP0-0001', 'VM-01-SUP0-0002',
  'VM-01-SUP0-1301', 'VM-01-SUP0-2001', 'VM-01-SUP0-2003', 'VM-01-SUP0-2004',
  'VM-01-SUP0-2005', 'VM-01-SUP0-2006', 'VM-01-SUP0-2007', 'VM-01-SUP0-2008',
  'VM-01-SUP0-2009', 'VM-01-SUP0-2010', 'VM-01-SUP0-2013', 'VM-01-SUP0-3101',
  'VM-01-SUP0-3201', 'VM-01-SUP0-3301', 'VM-01-SUP0-3302', 'VM-01-SUP0-3303',
  'VM-01-SUP0-3501', 'VM-01-SUP0-3502', 'VM-01-SUP0-4401', 'VM-01-SUP0-4402',
  'VM-01-SUP0-4403', 'VM-01-SUS0-1101', 'VM-01-SUS0-1201', 'VM-01-SUS0-1401',
  'VM-01-SUS0-1402', 'VM-01-SUS0-1403', 'VM-01-SUS0-1404', 'VM-01-SUS0-1406',
  'VM-01-SUS0-1407', 'VM-01-SUS0-3002', 'VM-01-SUS0-3401', 'VM-02-CAR0-3203',
  'VM-05-MOT0-0001', 'VM-05-MOT0-0101', 'VM-07-CARA-1101', 'VM-07-CARA-1201',
  'VM-07-ELE0-0002', 'VM-07-ELE0-0003', 'VM-07-ELE0-0004', 'VM-07-MOT0-0001',
  'VM-07-MOT0-0101', 'VM-07-ROD0-3001', 'VM-07-SUS0-3401',
];
