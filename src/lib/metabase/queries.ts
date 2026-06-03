// #29571 — Inventory + DOH via Maestro OS consumption (replaces #27759 IMS-ledger DOH)
export const METABASE_QUESTION_INVENTORY =
  Number(process.env.METABASE_QUESTION_INVENTORY) || 29571;

export const METABASE_QUESTION_CONSUMPTION =
  Number(process.env.METABASE_QUESTION_CONSUMPTION) || 29567;
