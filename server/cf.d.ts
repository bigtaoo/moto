// The few Cloudflare runtime shapes this Worker touches, written out rather than pulled in as a
// dependency: four methods and two bindings, against a types package that would have to be kept in step
// with the runtime. `lib: WebWorker` in server/tsconfig.json supplies Request, Response, URL and fetch.

interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
}

interface R2Objects {
  objects: R2Object[];
  /** With `delimiter`: everything past the next one is folded into these instead of into `objects`. */
  delimitedPrefixes?: string[];
  truncated: boolean;
  cursor?: string;
}

interface R2Body {
  text(): Promise<string>;
}

interface R2Bucket {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<R2Body | null>;
  list(options?: { prefix?: string; cursor?: string; limit?: number; delimiter?: string; startAfter?: string }): Promise<R2Objects>;
}

/** The rate-limit binding (wrangler `ratelimits`). Optional: without it the Worker still runs. */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** What `request.cf` carries at the edge. We read one field of it and store no address. */
interface IncomingCf {
  country?: string;
}
