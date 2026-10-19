/// <reference lib="webworker" />
import { SearchHost } from "./host";

type Method = "init" | "upsert" | "remove" | "query" | "snippets" | "close";
interface Request {
  id: number;
  method: Method;
  args: unknown[];
}

const host = new SearchHost();
// Requests are handled strictly in order so an index update always lands before the next query.
let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, method, args } = e.data;
  chain = chain.then(async () => {
    try {
      const fn = host[method] as (...a: unknown[]) => unknown;
      const result = await fn.apply(host, args);
      (self as unknown as Worker).postMessage({ id, ok: true, result });
    } catch (err) {
      (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
