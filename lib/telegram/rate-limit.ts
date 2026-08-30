// Best-effort in-memory rate limiter. Serverless instances aren't shared, so
// this only bounds abuse within a single warm instance — combined with the
// admin-cookie/webhook-secret gates already in front of these routes, that's
// a reasonable "smallest appropriate" mitigation without adding Redis.
const buckets = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

export function requestIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}
