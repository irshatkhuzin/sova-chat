import fs from "node:fs";
import path from "node:path";

/** Locate the package in both src/ and compiled dist/src/ layouts. */
function findServerRoot(): string {
  let dir = __dirname;
  while (true) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (pkg.name === "@sova/server") return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Cannot locate @sova/server package root");
    dir = parent;
  }
}

export const serverRoot = findServerRoot();
export const projectRoot = path.resolve(serverRoot, "..", "..");
