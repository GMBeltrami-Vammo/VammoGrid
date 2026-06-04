const METABASE_URL = process.env.METABASE_URL!;
const METABASE_API_KEY = process.env.METABASE_API_KEY!;

export async function fetchCardJson(
  questionId: number,
  // ignoreCache: false (default) — use Metabase's result cache (fast). Used by
  //   user-facing routes (inventory/consumption) which need low latency.
  // ignoreCache: true — force a fresh run. Used by the daily snapshot cron so the
  //   historical record is always current; safe because the route sets maxDuration=60.
  ignoreCache = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>[]> {
  const res = await fetch(
    `${METABASE_URL}/api/card/${questionId}/query/json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': METABASE_API_KEY,
      },
      body: JSON.stringify({ ignore_cache: ignoreCache }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Metabase query failed for card ${questionId}: ${res.status} ${res.statusText}`,
    );
  }

  return res.json();
}
