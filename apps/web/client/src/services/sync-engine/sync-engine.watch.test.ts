import { describe, expect, it } from 'bun:test';
import type { Provider } from '@onlook/code-provider';
import type { CodeFileSystem } from '@onlook/file-system';
import { CodeProviderSync } from './sync-engine';

/**
 * O observador de arquivos, quando o provedor não tem um.
 *
 * O Runtime Local lê os arquivos do projeto por um provedor de sistema de arquivos e não tem
 * processo observando nada. O `start()` deste motor sempre tentou abrir o observador, e no modo
 * local essa tentativa falha depois de já ter lido os arquivos — o que sobra é um erro a cada
 * abertura de projeto. O que esta verificação fixa é o contrato da opção: sem observação, os
 * arquivos continuam sendo lidos, e ninguém chama o observador.
 */

const file = (name: string, content: string) => ({ name, type: 'file' as const, content });

function createProvider(options: { failWatching?: boolean } = {}) {
    const calls = { watchFiles: 0 };
    const tree: Record<string, { name: string; type: 'file' | 'directory' }[]> = {
        './': [
            { name: 'app', type: 'directory' },
            { name: 'package.json', type: 'file' },
        ],
        app: [file('layout.tsx', 'export default function Layout() {}')],
    };
    const contents: Record<string, string> = {
        'package.json': '{"name":"fixture"}',
        'app/layout.tsx': 'export default function Layout() {}',
    };

    const provider = {
        listFiles: async ({ args }: { args: { path: string } }) => ({
            files: tree[args.path] ?? [],
        }),
        readFile: async ({ args }: { args: { path: string } }) => ({
            file: { type: 'text' as const, content: contents[args.path] ?? '' },
        }),
        writeFile: async () => ({}),
        watchFiles: async () => {
            calls.watchFiles += 1;
            if (options.failWatching) throw new Error('UNSUPPORTED_IN_LOCAL_MODE');
            return { watcher: { stop: async () => {} } };
        },
    };

    return { provider: provider as unknown as Provider, calls };
}

function createFileSystem() {
    const written: string[] = [];
    const fs = {
        rootPath: '/runtime',
        listAll: async () => [],
        listFiles: async () => [],
        readFile: async () => '',
        writeFile: async (path: string) => {
            written.push(path);
            return true;
        },
        createDirectory: async () => true,
        deleteFile: async () => true,
        deleteDirectory: async () => true,
        exists: async () => false,
        watchDirectory: () => () => {},
    };

    return { fs: fs as unknown as CodeFileSystem, written };
}

describe('CodeProviderSync file watching', () => {
    it('lê os arquivos do provedor e não abre observador quando a observação está desligada', async () => {
        const { provider, calls } = createProvider();
        const { fs, written } = createFileSystem();

        const sync = CodeProviderSync.getInstance(provider, fs, 'local-watch-off', { watch: false });

        await sync.start();

        expect(calls.watchFiles).toBe(0);
        expect(written.toSorted()).toEqual(['app/layout.tsx', 'package.json']);

        sync.release();
    });

    it('abre o observador quando a observação não foi desligada', async () => {
        const { provider, calls } = createProvider();
        const { fs } = createFileSystem();

        const sync = CodeProviderSync.getInstance(provider, fs, 'local-watch-on', {});

        await sync.start();

        expect(calls.watchFiles).toBe(1);

        sync.release();
    });

    it('falha visivelmente quando o provedor não tem observador e a observação foi pedida', async () => {
        const { provider } = createProvider({ failWatching: true });
        const { fs } = createFileSystem();

        const sync = CodeProviderSync.getInstance(provider, fs, 'local-watch-required', {});

        await expect(sync.start()).rejects.toThrow('UNSUPPORTED_IN_LOCAL_MODE');

        sync.release();
    });
});
