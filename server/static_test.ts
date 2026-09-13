// Static file tests: PWA dist serving, SPA fallback, traversal blocks.

import { assert, assertEquals } from "@std/assert";
import { resolveStaticPath, serveStatic } from "./static.ts";

async function fixtureDist(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "qala-dist-" });
  await Deno.mkdir(`${dir}/assets`, { recursive: true });
  await Deno.writeTextFile(`${dir}/index.html`, "<html>qala</html>");
  await Deno.writeTextFile(`${dir}/assets/app.js`, "console.log(1)");
  return dir;
}

Deno.test("static paths stay inside dist", async () => {
  const dir = await fixtureDist();
  try {
    assertEquals(resolveStaticPath(dir, "/"), `${dir}/index.html`);
    assertEquals(
      resolveStaticPath(dir, "/assets/app.js"),
      `${dir}/assets/app.js`,
    );
    assertEquals(resolveStaticPath(dir, "/../mod.ts"), null);
    assertEquals(resolveStaticPath(dir, "/%2e%2e/mod.ts"), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("dist serves files, SPA fallback, and 404s", async () => {
  const dir = await fixtureDist();
  try {
    const js = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/app.js"),
      dir,
    );
    assertEquals(js.status, 200);
    assert(js.headers.get("content-type")?.includes("javascript") ?? false);

    const route = await serveStatic(
      new Request("http://127.0.0.1:8500/plan"),
      dir,
    );
    assertEquals(route.status, 200);
    assert((await route.text()).includes("qala"));

    const missingAsset = await serveStatic(
      new Request("http://127.0.0.1:8500/assets/gone.js"),
      dir,
    );
    assertEquals(missingAsset.status, 404);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
