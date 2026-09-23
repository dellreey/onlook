import { describe, expect, it } from 'bun:test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LocalPreviewManager } from './local-preview';
import type { LocalProject } from './local-projects';

/**
 * O processo do preview, aberto de verdade.
 *
 * A sessão local responde com um endereço de preview que o servidor escolheu e subiu. O caminho que
 * abre esse processo era o único sem verificação própria — os testes injetam um processo falso —, e
 * é justamente onde ele dependia da API global do Bun, ausente no servidor do Next. Aqui o preview
 * é aberto pelo caminho real, encerrado, e a dependência do Bun é fixada por contrato.
 */

const project = (directory: string): LocalProject => ({
    id: 'preview-spawn',
    ownerId: 'user-a',
    title: 'preview-spawn',
    directory,
    createdAt: '2026-01-01T00:00:00.000Z',
});

const waitForFile = async (file: string, timeout = 10_000): Promise<string | null> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            return await readFile(file, 'utf8');
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    return null;
};

const isRunning = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

describe('LocalPreviewManager preview process', () => {
    it('abre o preview pelo servidor e encerra o processo que ele abriu', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'onlook-local-preview-'));
        const pidFile = path.join(directory, 'preview.pid');

        const previews = new LocalPreviewManager({
            // O processo escreve o próprio identificador, para a verificação poder confirmar que ele
            // existiu de verdade e que parou depois de `stop`.
            commandForPreview: (_project, port) => [
                process.execPath,
                '-e',
                `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
                '--port',
                String(port),
            ],
            firstPort: 4321,
            lastPort: 4329,
        });

        const preview = await previews.start(project(directory));

        expect(preview.url).toBe(`http://127.0.0.1:${preview.port}`);
        expect(preview.port).toBeGreaterThanOrEqual(4321);

        const pid = Number(await waitForFile(pidFile));
        expect(Number.isInteger(pid)).toBe(true);
        expect(isRunning(pid)).toBe(true);

        await previews.stop('preview-spawn');

        const deadline = Date.now() + 10_000;
        while (isRunning(pid) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(isRunning(pid)).toBe(false);
    });

    it('não usa a API global do Bun, que não existe no servidor do Next', async () => {
        const source = await readFile(new URL('./local-preview.ts', import.meta.url), 'utf8');

        expect(source).not.toMatch(/\bBun\./);
    });

    /**
     * O preview não pode sobreviver ao servidor que o abriu.
     *
     * Ele é o líder do próprio grupo de processos — é assim que `stop()` alcança os filhos que ele
     * abrir —, e o preço é não morrer junto com o pai. Sem a limpeza de encerramento, desligar o
     * editor deixaria um dev server do projeto segurando a porta e a memória: foi o que a
     * verificação seguinte encontrou, com a porta 4300 ocupada por um preview órfão.
     */
    it('encerra todos os previews vivos quando o servidor termina', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'onlook-local-preview-all-'));
        const pidFile = path.join(directory, 'preview.pid');

        const previews = new LocalPreviewManager({
            commandForPreview: (_project, port) => [
                process.execPath,
                '-e',
                `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
                '--port',
                String(port),
            ],
            firstPort: 4331,
            lastPort: 4339,
        });

        const preview = await previews.start(project(directory));
        expect(preview.port).toBeGreaterThanOrEqual(4331);

        const pid = Number(await waitForFile(pidFile));
        expect(isRunning(pid)).toBe(true);

        previews.killAll();

        const deadline = Date.now() + 10_000;
        while (isRunning(pid) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(isRunning(pid)).toBe(false);
    });
});
