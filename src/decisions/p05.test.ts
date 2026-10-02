// P-05 — a purely offline holiday adapter: it connects nowhere and therefore has no connection datapoint.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/**
 * Every product source file under src/ — tests and the guards themselves are not product code.
 *
 * @param dir the folder to walk
 * @returns the file paths
 */
function productSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "decisions") {
        out.push(...productSources(path));
      }
    } else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
      out.push(path);
    }
  }
  return out;
}

const NETWORK = [
  /(?:from|import|require\()\s*\(?\s*["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns)["']/,
  /(?:from|import|require\()\s*\(?\s*["'](?:axios|got|node-fetch|undici|ws|mqtt|ical|node-ical)["']/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\b/,
];

describe("P-05 offline, no connection datapoint", () => {
  it("P-05: no product source opens a network connection", () => {
    const files = productSources(SRC);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap(file => {
      const text = readFileSync(file, "utf8");
      return NETWORK.filter(re => re.test(text)).map(re => `${file}: ${re.source}`);
    });
    expect(hits).toEqual([]);
  });

  it("P-05: there is no connection datapoint, neither in the manifest nor in the code", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "io-package.json"), "utf8")) as {
      instanceObjects: { _id: string }[];
    };
    expect(manifest.instanceObjects.map(o => o._id)).not.toContain("info.connection");
    expect(productSources(SRC).filter(file => readFileSync(file, "utf8").includes("info.connection"))).toEqual([]);
  });
});
