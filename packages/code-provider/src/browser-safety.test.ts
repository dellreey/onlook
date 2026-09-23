import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * O índice do pacote é carregado pelo browser, então nada alcançável a partir dele pode importar
 * `node:*`.
 *
 * O defeito que este teste guarda é específico e já aconteceu: o provider de sistema de arquivos foi
 * reexportado pelo índice, e o chunk do cliente passou a pedir `node:fs/promises` —
 * "the chunking context does not support external modules". O build não avisa no servidor; quem
 * quebra é a página do projeto, no browser. Por isso a verificação é do grafo de módulos, e não do
 * comportamento de uma função.
 */

const sourceRoot = dirname(new URL(import.meta.url).pathname);
const nodeBuiltin = /^node:/;

async function moduleGraph(entry: string): Promise<string[]> {
    const visited: string[] = [];
    const pending = [entry];
    while (pending.length > 0) {
        const file = pending.pop()!;
        if (visited.includes(file)) continue;
        visited.push(file);
        const source = await readFile(file, 'utf8');
        const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
        for (const specifier of specifiers) {
            if (!specifier.startsWith('.')) continue;
            const candidates = [
                resolve(dirname(file), specifier),
                resolve(dirname(file), `${specifier}.ts`),
                resolve(dirname(file), specifier, 'index.ts'),
            ];
            for (const candidate of candidates) {
                try {
                    await readFile(candidate, 'utf8');
                    pending.push(candidate);
                    break;
                } catch {
                    // O candidato não existe; o próximo caminho é tentado.
                }
            }
        }
    }
    return visited;
}

describe('@onlook/code-provider browser entry', () => {
    it('never reaches a node: builtin from the package index', async () => {
        const graph = await moduleGraph(resolve(sourceRoot, 'index.ts'));
        const offenders: string[] = [];
        for (const file of graph) {
            const source = await readFile(file, 'utf8');
            for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
                if (nodeBuiltin.test(match[1]!)) {
                    offenders.push(`${file.slice(sourceRoot.length + 1)} imports ${match[1]}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps the NodeFs provider behind its own server entry', async () => {
        const index = await readFile(resolve(sourceRoot, 'index.ts'), 'utf8');
        expect(index).not.toContain("from './providers/nodefs'");

        const serverEntry = await readFile(resolve(sourceRoot, 'nodefs.ts'), 'utf8');
        expect(serverEntry).toContain("from './providers/nodefs'");
    });
});
