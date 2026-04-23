import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getTypeScriptFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('Singleton Architecture', () => {
  it('has exactly one Semaphore instantiation, in config/runtime.ts', () => {
    const srcDir = join(__dirname, '../../src');
    const files = getTypeScriptFiles(srcDir);
    const instantiations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      if (/new\s+Semaphore\s*\(/.test(content)) {
        instantiations.push(file);
      }
    }

    expect(instantiations).toHaveLength(1);
    expect(instantiations[0].replace(/\\/g, '/')).toContain('config/runtime.ts');
  });
});
