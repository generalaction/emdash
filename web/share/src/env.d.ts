declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SHARE_CREATE_LIMITER?: RateLimit;
  }
}
