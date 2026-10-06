import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(tsx?|mjs|css)$/.test(path) ? [path] : [];
  });
}

const runtimeFiles = ["app", "components", "context", "hooks", "integration", "domain", "demo", "repositories", "persistence", "utils", "config", "styles"]
  .flatMap(sourceFiles).concat("next.config.mjs");

describe("public demo runtime independence", () => {
  it("has no retired service imports, secret configuration, backend routes or install generators", () => {
    for (const path of runtimeFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/(?:from\s*|import\s*\(|require\s*\()?["'](?:@clerk\/|@prisma\/|@upstash\/|axios["']|[^"']*(?:server\/db|server\/functions|utils\/api|env\.mjs))/);
      expect(source, path).not.toMatch(/(?:DATABASE_URL|CLERK_SECRET_KEY|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|UPSTASH_REDIS_REST_(?:URL|TOKEN)|SKIP_ENV_VALIDATION)/);
    }
    for (const path of ["app/api", "app/(auth)", "server", "prisma", "utils/api", "middleware.ts", "env.mjs", "context/transitional-auth.tsx", "integration/development-auth.ts", "hooks/use-is-authed.ts", "components/modals/auth", "context/use-auth-modal.tsx"]) {
      expect(existsSync(path), path).toBe(false);
    }
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>;
      scripts: Record<string, string>; prisma?: unknown;
    };
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).not.toEqual(expect.arrayContaining(["axios"]));
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => /^(?:@clerk\/|@prisma\/|@upstash\/|prisma$|ts-node$|superjson$)/.test(name))).toEqual([]);
    expect(manifest.prisma).toBeUndefined();
    expect(manifest.scripts.postinstall).toBeUndefined();
  });

  it("needs no automatic application network transport or remote presentation assets", () => {
    for (const path of runtimeFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket)|next\/font\/google/);
      expect(source, path).not.toMatch(/src\s*=\s*["']https?:\/\/|url\(\s*["']?https?:\/\//);
    }
    expect(readFileSync("components/top-navbar.tsx", "utf8")).toContain('src="/icon.svg"');
    expect(existsSync("app/icon.svg")).toBe(true);
  });
});
