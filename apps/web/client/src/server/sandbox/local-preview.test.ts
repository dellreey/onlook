import { describe, expect, it } from 'bun:test';

import type { LocalProject } from './local-projects';
import { LocalPreviewManager } from './local-preview';

const project = (id: string): LocalProject => ({
    id,
    ownerId: 'user-a',
    title: id,
    directory: `/tmp/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
});

describe('LocalPreviewManager', () => {
    it('allocates different free ports for concurrent projects', async () => {
        const previews = new LocalPreviewManager({
            commandForPreview: (_project, port) => ['bun', 'run', 'dev', '--port', String(port)],
            firstPort: 4311,
            lastPort: 4313,
            isPortFree: async () => true,
            startProcess: () => ({ exited: new Promise(() => {}), kill: () => {} }),
        });

        const first = await previews.start(project('a'));
        const second = await previews.start(project('b'));

        expect(first.port).not.toBe(second.port);
        expect(first.url).toBe(`http://127.0.0.1:${first.port}`);
    });

    it('stopping one project keeps the other preview running', async () => {
        const previews = new LocalPreviewManager({
            commandForPreview: (_project, port) => ['bun', 'run', 'dev', '--port', String(port)],
            firstPort: 4311,
            lastPort: 4313,
            isPortFree: async () => true,
            startProcess: () => ({ exited: new Promise(() => {}), kill: () => {} }),
        });
        const first = project('a');
        const second = project('b');
        await previews.start(first);
        await previews.start(second);

        await previews.stop(first.id);

        await expect(previews.status(second.id)).resolves.toMatchObject({ state: 'running' });
    });

    it('passes the allocated port to the server-selected preview command', async () => {
        let command: string[] = [];
        const previews = new LocalPreviewManager({
            commandForPreview: (_project, port) => ['bun', 'run', 'dev', '--', '--port', String(port)],
            firstPort: 4317,
            lastPort: 4317,
            isPortFree: async () => true,
            startProcess: (next) => {
                command = next;
                return { exited: new Promise(() => {}), kill: () => {} };
            },
        });

        await previews.start(project('port-check'));
        expect(command).toEqual(['bun', 'run', 'dev', '--', '--port', '4317']);
    });
});
