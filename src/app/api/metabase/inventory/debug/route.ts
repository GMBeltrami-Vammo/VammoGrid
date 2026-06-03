import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { fetchCardJson } from '@/lib/metabase/client';
import { METABASE_QUESTION_INVENTORY } from '@/lib/metabase/queries';

export const dynamic = 'force-dynamic';

/** Debug only — shows first 2 raw rows from Metabase (authenticated users only) */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await fetchCardJson(METABASE_QUESTION_INVENTORY);
    return NextResponse.json({
      question: METABASE_QUESTION_INVENTORY,
      rowCount: rows.length,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      first2Rows: rows.slice(0, 2),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
