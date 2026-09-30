declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SESSION_SECRET?: string;
    JUDGE0_URL?: string;
    JUDGE0_API_KEY?: string;
  }
}
