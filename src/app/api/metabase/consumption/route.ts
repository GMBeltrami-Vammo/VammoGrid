import { NextResponse } from 'next/server';
import { fetchCardJson } from '@/lib/metabase/client';
import { METABASE_QUESTION_CONSUMPTION } from '@/lib/metabase/queries';
import { transformConsumptionRows } from '@/lib/transformer';

export const revalidate = 300; // 5-minute server cache

export async function GET() {
  try {
    const rows = await fetchCardJson(METABASE_QUESTION_CONSUMPTION);
    const records = transformConsumptionRows(rows);
    return NextResponse.json(records);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/metabase/consumption]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
