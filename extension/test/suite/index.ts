import * as fs from "node:fs";
import * as path from "node:path";
import Mocha from "mocha";

function findTestFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Contract required by @vscode/test-electron: this module must export a
 * `run()` that resolves on success and rejects (or throws) on any test
 * failure. */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30000 });
  for (const file of findTestFiles(__dirname)) {
    mocha.addFile(file);
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
