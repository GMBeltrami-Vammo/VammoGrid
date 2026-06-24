-- ─────────────────────────────────────────────────────────────────────────────
-- Hot-start seed: open purchase orders imported from orders_list.xlsx
-- Source: C:\Users\gabri\OneDrive\Desktop\Vammo\orders-monitor\output\orders_list.xlsx
-- Imported: 2026-06-24
-- Idempotent: each VO block is guarded by IF NOT EXISTS.
-- TBD-SKU rows (no sku_code assigned) are intentionally omitted.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN

  -- ─── VO 241 — Sea (order: 2026-03-03, ETA: 2026-06-21, LT: 110d) ──────────
  IF NOT EXISTS (SELECT 1 FROM fleet.purchase_order WHERE vo = '241') THEN
    INSERT INTO fleet.purchase_order
      (vo, sku, sku_name, qty_ordered, order_date, eta, lead_time_days, status, modal, hub_id, source, updated_at)
    VALUES
      ('241','VM-01-BAT0-0007-01-01','Battery BMS circuit board(60V45Ah)A', 75,'2026-03-03','2026-06-21',110,'ordered','sea','osasco','xlsx',now()),
      ('241','VM-01-BAT0-0008-01-01','Battery BMS circuit board(60V45Ah)B', 55,'2026-03-03','2026-06-21',110,'ordered','sea','osasco','xlsx',now());
  END IF;

  -- ─── VO 256 — Spare parts bat. mar.26 — Sea (order: 2026-03-27, ETA: 2026-07-15) ──
  IF NOT EXISTS (SELECT 1 FROM fleet.purchase_order WHERE vo = '256') THEN
    INSERT INTO fleet.purchase_order
      (vo, sku, sku_name, qty_ordered, order_date, eta, lead_time_days, status, modal, hub_id, source, updated_at)
    VALUES
      ('256','VM-01-BAT0-0002-01-01','Battery handle',                          52,'2026-03-27','2026-07-15',110,'ordered','sea','osasco','xlsx',now()),
      ('256','VM-01-BAT0-0003-01-01','Battery maintenance label',               60,'2026-03-27','2026-07-15',110,'ordered','sea','osasco','xlsx',now()),
      ('256','VM-01-BAT0-0004-01-01','Battery upper cover',                     80,'2026-03-27','2026-07-15',110,'ordered','sea','osasco','xlsx',now()),
      ('256','VM-01-BAT0-0007-01-01','Battery BMS circuit board(60V45Ah)A',     35,'2026-03-27','2026-07-15',110,'ordered','sea','osasco','xlsx',now()),
      ('256','VM-01-BAT0-0008-01-01','Battery BMS circuit board(60V45Ah)B',     70,'2026-03-27','2026-07-15',110,'ordered','sea','osasco','xlsx',now()),
      ('256','VM-01-BAT0-0009-01-01','Connector Wire,BMS A-B circuit board',    20,'2026-03-27','2026-07-15',110,'ordered','sea','osasco','xlsx',now()),
      ('256','VM-07-BAT0-0004-01-01','Upper Cover',                            200,'2026-03-27','2026-07-15',110,'ordered','sea','osasco','xlsx',now());
  END IF;

  -- ─── VO 277.1 — Spare parts Air May.26 (order: 2026-05-31, ETA: 2026-09-18) ─
  IF NOT EXISTS (SELECT 1 FROM fleet.purchase_order WHERE vo = '277.1') THEN
    INSERT INTO fleet.purchase_order
      (vo, sku, sku_name, qty_ordered, order_date, eta, lead_time_days, status, modal, hub_id, source, updated_at)
    VALUES
      ('277.1','VM-01-ROD0-3001',     'Wheel Hub Assy,Rr',                       90,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-ELE0-0004',     'Sub harness 3500W',                      115,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-SUP0-3301',     'Shelf,Rr',                                40,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-CARA-3201',     'Cover,Body L(Sticker), CB19N/ Blue',     425,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-ROD0-1001',     'Wheel Assy.,Fr',                          76,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-CARA-3101',     'Cover,Body R(Sticker), CB19N/ Blue',     280,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-ELE0-0010',     'Lockset ,Vehicle',                       300,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-CAR0-3501',     'Fender,Rr',                               70,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-CAR0-2102',     'R Side Cover, Center',                   447,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-CAR0-2202',     'L Side Cover, Center',                   411,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-ACS0-0003',     'Weight,Handle',                         1000,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-OTH0-0201',     'Left Logo',                              462,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-ILU0-3501',     'Taillight Assy',                         111,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-FRE0-3001',     'Disc,Rr Brake',                          665,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-OTH0-0101',     'Right Logo',                             346,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-ILU0-1001',     'Reflex Reflector,Side',                  548,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-FRE0-0002',     'Mounting Screw,Brk Disc 8X25',           757,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-CAR0-1101',     'Garnish R,Fr Cover',                     170,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-SUS0-1407',     'Outer ring(HR32006XJ)',                  1000,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-DIR0-0003',     'Bridge,Top',                              30,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-CAR0-1201',     'Garnish L,Fr Cover',                      62,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-BAT0-0002-01-01','Battery handle',                         30,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-BAT0-0004-01-01','Battery upper cover',                    30,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now()),
      ('277.1','VM-01-BAT0-0003-01-01','Battery maintenance label',             150,'2026-05-31','2026-09-18',110,'ordered','air','osasco','xlsx',now());
  END IF;

  -- ─── VO 278 — Spare parts VS4 (order: 2026-06-12, ETA: 2026-09-30) ───────
  IF NOT EXISTS (SELECT 1 FROM fleet.purchase_order WHERE vo = '278') THEN
    INSERT INTO fleet.purchase_order
      (vo, sku, sku_name, qty_ordered, order_date, eta, lead_time_days, status, modal, hub_id, source, updated_at)
    VALUES
      ('278','VM-08-ILU0-0001-01-01',  'Headlight',                           3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUS0-1201-01-01',  'Front shock absorber, Left side',     3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUS0-1101-01-01',  'Front shock absorber, Right side',    3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ROD0-1001-01-01',  'Front wheel',                         3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-CARP-1502-01-01',  'Front fender',                        3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-DIR0-0001-01-01',  'Handlebar',                           2,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-CAR0-1201-01-01',  'Front cover, Left side',              3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-CAR0-1101-01-01',  'Front cover, Right side',             3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-FRE0-1005-01-01',  'Front brake pads',                    5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-FRE0-3005-01-01',  'Rear brake pads',                     5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-FRE0-1001-01-01',  'Front brake discs',                   4,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-FRE0-3001-01-01',  'Rear brake discs',                    3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUP0-2001-01-01',  'Side stand, Left side',               5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUP0-1201-01-01',  'Driver foot rest, Left side',         5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUP0-1101-01-01',  'Driver foot rest, Right side',        5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUP0-3201-01-01',  'Passenger foot rest, Left side',      5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUP0-3101-01-01',  'Passenger foot rest, Right side',     5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-OTH0-4405-01-01',  'Driver seat',                         2,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUS0-3002-01-01',  'Swingarm',                            3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ACS0-3501-01-01',  'Swingarm cover',                      3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ELE0-0010-01-01',  'Lockset - Battery compartment',       3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-MOT0-0001-01-01',  'Central motor',                       1,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUS0-1403-01-01',  'Steering column bearings kit',        5,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUS0-3201-01-01',  'Rear shock absorber, Left side',      3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUS0-3101-01-01',  'Rear shock absorber, Right side',     3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ROD0-3001-01-01',  'Rear wheel',                          3,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ACS0-3503-01-01',  'License plate bracket',               2,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ELE0-0002-01-01',  'Controller',                          1,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ILU0-3501-01-01',  'Taillight',                           2,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ILU0-3201-01-01',  'Winker, Left side',                   4,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-ILU0-1201-01-01',  'Winker, Right side',                  4,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now()),
      ('278','VM-08-SUP0-2007-01-01',  'Main Stand',                          2,'2026-06-12','2026-09-30',110,'ordered','sea','osasco','xlsx',now());
  END IF;

  -- ─── VO 281 — 408 Batteries for the network (order: 2026-06-15, ETA: 2026-10-03) ──
  -- Note: source SKU is "VM07-BAT0-0001-01-01" (no hyphen between VM and 07); may not
  -- match IMS catalog exactly — reconcile manually if needed.
  IF NOT EXISTS (SELECT 1 FROM fleet.purchase_order WHERE vo = '281') THEN
    INSERT INTO fleet.purchase_order
      (vo, sku, sku_name, qty_ordered, order_date, eta, lead_time_days, status, modal, hub_id, source, updated_at)
    VALUES
      ('281','VM07-BAT0-0001-01-01','Batteries 74v28amph',408,'2026-06-15','2026-10-03',110,'ordered','sea','osasco','xlsx',now());
  END IF;

END $$;

-- Backfill sku_base for freshly inserted rows (mirrors the logic in migration_v2).
UPDATE fleet.purchase_order
   SET sku_base = array_to_string((string_to_array(sku, '-'))[1:4], '-')
 WHERE sku_base IS NULL
   AND source = 'xlsx';
