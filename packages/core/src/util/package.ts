import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const __dirname = import.meta.dirname;
const MAX_PARENT_TRAVERSAL = 10;

export interface PackageInfo {
  name: string;
  version: string;
  description: string;
}

let _pkg: PackageInfo | null = null;

function findPackageJson(): string {
  let current = __dirname;
  for (let i = 0; i < MAX_PARENT_TRAVERSAL; i++) {
    const pkgPath = join(current, "package.json");
    if (existsSync(pkgPath)) {
      return pkgPath;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Cannot find package.json");
}

export function getPackageInfo(): PackageInfo {
  if (_pkg === null) {
    const pkgPath = findPackageJson();
    _pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageInfo;
  }
  return _pkg;
}
