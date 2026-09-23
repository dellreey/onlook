import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDrivenClient } from './client';

/**
 * O serviço de skills do Driven, de verdade, para os testes de integração do adaptador.
 *
 * Um dublê provaria que o cliente sabe montar um corpo de requisição. Não provaria que o serviço
 * aceita esse corpo, nem que a ordem que o adaptador executa é a ordem que o serviço espera — e é
 * isso que estes testes precisam saber. O serviço é o do próprio produto, iniciado com o avaliador
 * determinístico (`JEV_STUB_EVALUATOR`) para não depender de rede nem de credencial, apontado para
 * um depósito temporário para não escrever na bancada de quem trabalha.
 *
 * O serviço vive no repositório principal, e o editor em um submódulo dele. O caminho vem do próprio
 * git (`--show-superproject-working-tree`), e não de um caminho fixo: quem tiver o fork sozinho não
 * tem o serviço, e a verificação se declara fora em vez de fingir cobertura — daí `serviceRoot` ser
 * `null` nesse caso, e cada teste tratar isso como "não há o que medir aqui".
 */

export type SkillsService = {
    /** O cliente apontado para o serviço temporário, com a rota viva do canvas. */
    client: ReturnType<typeof createDrivenClient>;
    /** O caminho do depósito de variantes, para quem quiser conferir o que foi gravado. */
    variantsPath: string;
    /** Encerra o serviço e apaga o depósito temporário. */
    stop: () => Promise<void>;
};

const onlookRoot = path.resolve(import.meta.dir, '../../../../../..');

/** O serviço só existe quando o editor está dentro do projeto principal. */
export const superprojectRoot = async (): Promise<string | null> => {
    const child = spawn('git', ['-C', onlookRoot, 'rev-parse', '--show-superproject-working-tree']);
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    const code = await new Promise<number>((resolve) => child.once('close', (value) => resolve(value ?? 1)));
    const root = out.trim();
    return code === 0 && root.length > 0 ? root : null;
};

const freePort = (): Promise<number> =>
    new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            server.close(() => (port ? resolve(port) : reject(new Error('no port'))));
        });
    });

const waitForService = async (url: string, timeout = 60_000): Promise<void> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const response = await fetch(url).catch(() => null);
        if (response?.ok) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`o serviço de skills não respondeu em ${url}`);
};

/**
 * Sobe o serviço com o depósito de variantes e a marca que o teste pedir.
 *
 * A marca é sempre gravada, mesmo quando o teste não fala dela: sem o arquivo o serviço responde uma
 * marca vazia, e um teste de marca mediria a degradação em vez do ciclo.
 */
export const startSkillsService = async ({
    serviceRoot,
    variants,
    brand = { schemaVersion: 2 },
}: {
    serviceRoot: string;
    variants: unknown;
    brand?: unknown;
}): Promise<SkillsService> => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'onlook-skills-'));
    const variantsPath = path.join(workspace, 'section-variants.json');
    await writeFile(variantsPath, JSON.stringify(variants));
    await writeFile(path.join(workspace, 'brand.json'), JSON.stringify(brand));

    const port = await freePort();
    const service: ChildProcess = spawn(
        'node',
        [path.join(serviceRoot, 'scripts', 'page-studio-skills-server.mjs')],
        {
            cwd: serviceRoot,
            stdio: 'ignore',
            env: {
                ...process.env,
                PAGE_STUDIO_PORT: String(port),
                PAGE_STUDIO_VARIANTS: variantsPath,
                PAGE_STUDIO_BRAND: path.join(workspace, 'brand.json'),
                PAGE_STUDIO_PUBLISH_ROOT: path.join(workspace, 'published'),
                PAGE_STUDIO_ASSETS: path.join(workspace, 'assets'),
                JEV_STUB_EVALUATOR: '1',
            },
        },
    );

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForService(`${baseUrl}/api/page-studio-skills/catalog`);

    return {
        // O mesmo par de endereços que a rota usa: o serviço para operar, a rota viva para o canvas.
        client: createDrivenClient({ baseUrl, previewBaseUrl: 'http://127.0.0.1:3200' }),
        variantsPath,
        stop: async () => {
            service.kill('SIGTERM');
            await rm(workspace, { recursive: true, force: true });
        },
    };
};
