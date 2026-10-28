import { fetchJson, Limiter, TTL, ET_CLIENT_NAME } from "./http.ts";

export const JP_URL = "https://api.entur.io/journey-planner/v3/graphql";
export const NSR_URL = "https://api.entur.io/stop-places/v1/read";
export const MOBILITY_URL = "https://api.entur.io/mobility/v2/graphql";

export const enturLimiter = new Limiter(4, 60);
export const nsrLimiter = new Limiter(3, 80);

export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  opts: { ttl?: number; label?: string } = {},
): Promise<T> {
  const body = JSON.stringify({ query, variables });
  const res = await fetchJson<{ data?: T; errors?: { message: string }[] }>(JP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ET-Client-Name": ET_CLIENT_NAME },
    body,
    ttl: opts.ttl ?? TTL.entur,
    limiter: enturLimiter,
    label: opts.label ?? "journey-planner",
  });
  if (res.errors?.length) {
    throw new Error(`GraphQL-feil (${opts.label ?? "jp"}): ${res.errors.map((e) => e.message).join("; ")}`);
  }
  if (!res.data) throw new Error(`Tomt GraphQL-svar (${opts.label ?? "jp"})`);
  return res.data;
}

export async function nsrGet<T>(path: string): Promise<T> {
  return fetchJson<T>(`${NSR_URL}${path}`, {
    headers: { "ET-Client-Name": ET_CLIENT_NAME },
    ttl: TTL.nsr,
    limiter: nsrLimiter,
    label: `nsr ${path}`,
  });
}
