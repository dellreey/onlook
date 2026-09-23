import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalProjectRegistry } from './local-projects';

describe('LocalProjectRegistry', () => {
    let root: string;
    let template: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'onlook-local-projects-'));
        template = join(root, 'template');
        await mkdir(template);
        await writeFile(join(template, 'README.md'), 'approved template');
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('creates projects below the configured root with opaque ids', async () => {
        const registry = new LocalProjectRegistry({ projectsRoot: root, templateDirectory: template });

        const project = await registry.create('user-a', 'My project');

        expect(project.directory).toMatch(new RegExp(`${root}/projects/[a-z0-9-]+$`));
        expect(project.ownerId).toBe('user-a');
        expect(project.id).toMatch(/^[a-z0-9-]+$/);
        await expect(readFile(join(project.directory, 'README.md'), 'utf8')).resolves.toBe('approved template');
    });

    it('lists only projects belonging to the requested owner', async () => {
        const registry = new LocalProjectRegistry({ projectsRoot: root, templateDirectory: template });
        await registry.create('user-a', 'A');
        await registry.create('user-b', 'B');

        await expect(registry.list('user-a')).resolves.toHaveLength(1);
    });

    it('does not use a title as a filesystem path', async () => {
        const registry = new LocalProjectRegistry({ projectsRoot: root, templateDirectory: template });
        const project = await registry.create('user-a', '../not-a-directory');

        await expect(access(join(root, 'not-a-directory'))).rejects.toThrow();
        expect(project.directory).not.toContain('not-a-directory');
    });

    it('deletes only the owned project directory and registry entry', async () => {
        const registry = new LocalProjectRegistry({ projectsRoot: root, templateDirectory: template });
        const mine = await registry.create('user-a', 'Mine');
        const theirs = await registry.create('user-b', 'Theirs');

        await expect(registry.delete('user-a', mine.id)).resolves.toBe(true);
        await expect(access(mine.directory)).rejects.toThrow();
        await expect(registry.list('user-a')).resolves.toEqual([]);
        await expect(access(theirs.directory)).resolves.toBeNull();
        await expect(registry.delete('user-a', theirs.id)).resolves.toBe(false);
    });
});
