import { mkdir, rm, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempTestDir {
  /** Root of the temp directory tree (under os.tmpdir()). */
  root: string;
  /** A directory that tests should configure as "allowed". */
  allowed: string;
  /** A directory outside the allowed list. */
  forbidden: string;
  /** Remove the entire tree. Call in afterAll. */
  cleanup: () => Promise<void>;
}

export async function createTempTestDir(): Promise<TempTestDir> {
  const root = join(tmpdir(), `mcp-test-${randomUUID()}`);
  const allowed = join(root, 'allowed');
  const forbidden = join(root, 'forbidden');

  await mkdir(join(allowed, 'sub'), { recursive: true });
  await mkdir(forbidden, { recursive: true });

  // Symlink that stays within the allowed tree
  await symlink(join(allowed, 'sub'), join(allowed, 'legit-link'));
  // Symlink that escapes to forbidden
  await symlink(forbidden, join(allowed, 'escape-link'));

  return {
    root,
    allowed,
    forbidden,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
