const METABASE_URL = process.env.METABASE_URL!;
const METABASE_API_KEY = process.env.METABASE_API_KEY!;

export async function fetchCardJson(
  questionId: number,
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
      body: JSON.stringify({ ignore_cache: false }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Metabase query failed for card ${questionId}: ${res.status} ${res.statusText}`,
    );
  }

  return res.json();
}
