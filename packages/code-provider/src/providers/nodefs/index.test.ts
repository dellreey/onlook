import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeFsProvider } from './index';

describe('NodeFsProvider', () => {
    let root: string;
    let outside: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'onlook-nodefs-project-'));
        outside = join(root, '..', 'outside-write');
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    });

    it('persists file operations inside its configured project root', async () => {
        const provider = new NodeFsProvider({ projectRoot: root });
        await provider.createDirectory({ args: { path: 'src' } });
        await provider.writeFile({ args: { path: 'src/page.tsx', content: 'export const page = 1;' } });

        await expect(readFile(join(root, 'src/page.tsx'), 'utf8')).resolves.toBe('export const page = 1;');
        await expect(provider.readFile({ args: { path: 'src/page.tsx' } })).resolves.toMatchObject({
            file: { path: 'src/page.tsx', content: 'export const page = 1;', type: 'text' },
        });

        await provider.renameFile({ args: { oldPath: 'src/page.tsx', newPath: 'src/home.tsx' } });
        await expect(provider.listFiles({ args: { path: 'src' } })).resolves.toEqual({
            files: [{ name: 'home.tsx', type: 'file', isSymlink: false }],
        });
    });

    it('rejects a traversal write without creating a file outside the project', async () => {
        const provider = new NodeFsProvider({ projectRoot: root });

        await expect(
            provider.writeFile({ args: { path: '../outside-write/secret.txt', content: 'secret' } }),
        ).rejects.toThrow('outside project root');
        await expect(access(join(outside, 'secret.txt'))).rejects.toThrow();
    });

    /**
     * As duas perguntas que o editor faz em toda abertura de projeto.
     *
     * Ele garante que `public` exista antes de escrever o preload, e pergunta pela raiz de rotas
     * (`app`, `src/app`) sem saber se ela existe. Como conflito e ausência, essas perguntas viravam
     * erro de servidor — e a tela mostrava erro de rede no lugar do editor.
     */
    it('trata diretório existente e diretório ausente como respostas, não como erros', async () => {
        const provider = new NodeFsProvider({ projectRoot: root });

        await provider.createDirectory({ args: { path: 'public' } });
        await expect(provider.createDirectory({ args: { path: 'public' } })).resolves.toEqual({});

        await expect(provider.listFiles({ args: { path: 'src/app' } })).resolves.toEqual({ files: [] });
    });
});
