import { NextResponse } from 'next/server';
import { METABASE_QUESTION_CONSUMPTION } from '@/lib/metabase/queries';

export const revalidate = 300;

export async function GET() {
  if (!METABASE_QUESTION_CONSUMPTION) {
    // Consumption question not yet configured — return empty dataset
    return NextResponse.json([]);
  }

  try {
    const { fetchCardJson } = await import('@/lib/metabase/client');
    const rows = await fetchCardJson(METABASE_QUESTION_CONSUMPTION);
    // TODO: transform rows to ConsumptionRecord[] once question schema is known
    return NextResponse.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/metabase/consumption]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
