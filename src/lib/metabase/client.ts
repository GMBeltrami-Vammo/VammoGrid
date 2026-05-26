const METABASE_URL = process.env.METABASE_URL!;
const METABASE_USERNAME = process.env.METABASE_USERNAME!;
const METABASE_PASSWORD = process.env.METABASE_PASSWORD!;

let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function getSessionToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }

  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: METABASE_USERNAME,
      password: METABASE_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`Metabase auth failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { id: string };
  cachedToken = data.id;
  tokenFetchedAt = now;
  return cachedToken;
}

export async function fetchCardJson(
  questionId: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>[]> {
  const token = await getSessionToken();

  const res = await fetch(
    `${METABASE_URL}/api/card/${questionId}/query/json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Metabase-Session': token,
      },
      body: JSON.stringify({ ignore_cache: false }),
    },
  );

  // On 401, invalidate token and retry once
  if (res.status === 401) {
    cachedToken = null;
    return fetchCardJson(questionId);
  }

  if (!res.ok) {
    throw new Error(
      `Metabase query failed for card ${questionId}: ${res.status} ${res.statusText}`,
    );
  }

  return res.json();
}
