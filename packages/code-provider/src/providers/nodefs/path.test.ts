import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProjectPath } from './path';

describe('resolveProjectPath', () => {
    let root: string;
    let outside: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'onlook-nodefs-root-'));
        outside = await mkdtemp(join(tmpdir(), 'onlook-nodefs-outside-'));
        await mkdir(join(root, 'nested'));
    });

    afterEach(async () => {
        await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
    });

    it.each(['../secret', '/etc/passwd', 'nested/../../secret'])(
        'rejects an escaping path: %s',
        async (requestedPath) => {
            await expect(resolveProjectPath(root, requestedPath)).rejects.toThrow('outside project root');
        },
    );

    it('rejects a symlink which points outside the project root', async () => {
        const outsideFile = join(outside, 'secret');
        await writeFile(outsideFile, 'secret');
        await symlink(outsideFile, join(root, 'escape'));

        await expect(resolveProjectPath(root, 'escape')).rejects.toThrow('outside project root');
    });

    it('returns a canonical path for a file inside the project root', async () => {
        const file = join(root, 'nested', 'page.tsx');
        await writeFile(file, 'export default function Page() {}');

        await expect(resolveProjectPath(root, 'nested/page.tsx')).resolves.toBe(file);
    });
});
