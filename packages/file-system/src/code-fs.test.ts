import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

// O ZenFS só existe no navegador: ele se registra em `globalThis` ao ser importado e nem chega a
// carregar fora dele. Estes testes exercitam o caminho em que o sistema de arquivos nunca foi
// aberto, então a montagem dele fica de fora — e os testes seguem medindo o editor, não o ZenFS.
mock.module('@zenfs/core', () => ({ default: {}, configure: async () => {} }));
mock.module('@zenfs/dom', () => ({ IndexedDB: class IndexedDB {} }));

const { CodeFileSystem } = await import('./code-fs');
const { clearIndexCache, getIndexFromCache } = await import('./index-cache');

/**
 * `cleanup()` é um caminho de desmontagem: ele roda quando a branch sai de cena, e não tem quem
 * espere pelo resultado. Um estouro aqui vira rejeição sem dono no navegador, sem relação com o
 * que a pessoa estava fazendo.
 */
describe('CodeFileSystem.cleanup', () => {
    const projectId = 'projeto-de-limpeza';
    const branchIds: string[] = [];

    const newBranchId = (name: string): string => {
        const branchId = `${name}-${branchIds.length}`;
        branchIds.push(branchId);
        return branchId;
    };

    const silenceWarnings = (): (() => void) => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        return () => warn.mockRestore();
    };

    afterEach(() => {
        for (const branchId of branchIds) {
            clearIndexCache(`${projectId}/${branchId}`);
        }
        branchIds.length = 0;
    });

    /**
     * Um índice carregado de verdade só existe com o sistema de arquivos aberto. O que um `{}` no
     * cache antes de `initialize()` significa é isto: a leitura falhou, e o cache guardou o vazio.
     */
    const seedIndexFromFailedRead = async (fs: { getJsxElementMetadata(oid: string): Promise<unknown> }) => {
        await fs.getJsxElementMetadata('oid-que-nao-existe');
    };

    it('resolve quando o sistema de arquivos nunca foi aberto', async () => {
        const restore = silenceWarnings();
        try {
            const fs = new CodeFileSystem(projectId, newBranchId('nunca-aberto'));

            await expect(fs.cleanup()).resolves.toBeUndefined();
        } finally {
            restore();
        }
    });

    it('não inventa aviso quando não havia índice para gravar', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const fs = new CodeFileSystem(projectId, newBranchId('avisa'));

            await fs.cleanup();

            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('diz no console que pulou a gravação do índice, em vez de sumir em silêncio', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const fs = new CodeFileSystem(projectId, newBranchId('pulou'));
            await seedIndexFromFailedRead(fs);

            await fs.cleanup();

            const messages = warn.mock.calls.map((call) => call.join(' ')).join('\n');
            expect(messages).toContain('Skipped saving the index');
            expect(messages).toContain('has not been initialized');
        } finally {
            warn.mockRestore();
        }
    });

    it('não deixa o índice no cache quando a limpeza não pôde gravar', async () => {
        const restore = silenceWarnings();
        try {
            const branchId = newBranchId('cache');
            const fs = new CodeFileSystem(projectId, branchId);

            // Um objeto vazio é verdadeiro: era isso que fazia a limpeza tentar gravar `{}` num
            // sistema de arquivos que ainda não tinha sido aberto.
            await seedIndexFromFailedRead(fs);
            expect(getIndexFromCache(`${projectId}/${branchId}`)).toBeDefined();

            await fs.cleanup();

            expect(getIndexFromCache(`${projectId}/${branchId}`)).toBeUndefined();
        } finally {
            restore();
        }
    });
});
