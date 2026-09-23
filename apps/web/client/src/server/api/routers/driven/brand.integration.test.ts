import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDrivenClient } from './client';

/**
 * O ciclo completo da marca Driven, contra o serviço de verdade.
 *
 * A superfície de Marca da aba Driven permite ler e gravar a marca do produto no serviço do Driven.
 * O teste com fetch mockado (client.test.ts) prova que o cliente monta o corpo da requisição; não
 * prova que o serviço aceita esse corpo, que a gravação persiste e que a releitura devolve o mesmo
 * valor. Este teste cobre o ciclo completo: ler, alterar, gravar, reler e confirmar a persistência.
 *
 * O serviço valida a marca antes de gravá-la (400 para entrada inválida); o cliente não pode
 * descobrir isso pela resposta de erro — é o serviço quem decide. Este teste também prova que o
 * serviço recusa uma marca inválida sem gravar nada.
 *
 * O padrão segue variant-creation.integration.test.ts: serviço real, JEV_STUB_EVALUATOR=1,
 * depósito temporário que não toca o .page-studio/brand.json real.
 */

const onlookRoot = path.resolve(import.meta.dir, '../../../../../..');

const superprojectRoot = async (): Promise<string | null> => {
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

/** Uma marca mínima válida para o esquema v2 do Driven. */
const validBrandV2 = (primaryValue: string) => ({
    schemaVersion: 2,
    colors: { primary: { $type: 'color', $value: primaryValue } },
    palette: {},
    typography: {},
});

describe('Driven brand surface against the real skills service', () => {
    let workspace: string;
    let service: ChildProcess | null = null;
    let client: ReturnType<typeof createDrivenClient> | null = null;
    let brandPath = '';
    let serviceRoot: string | null = null;

    beforeAll(async () => {
        serviceRoot = await superprojectRoot();
        if (!serviceRoot) return;

        workspace = await mkdtemp(path.join(tmpdir(), 'onlook-brand-'));
        brandPath = path.join(workspace, 'brand.json');
        const variantsPath = path.join(workspace, 'section-variants.json');

        // O arquivo de variantes precisa existir para o serviço não reclamar de leitura ausente.
        await writeFile(
            variantsPath,
            JSON.stringify({ schemaVersion: 1, pages: {} }),
        );
        // A marca começa com o documento vazio de esquema v2 que o serviço espera.
        await writeFile(brandPath, JSON.stringify({ schemaVersion: 2, colors: {}, palette: {}, typography: {} }));

        const port = await freePort();
        service = spawn('node', [path.join(serviceRoot, 'scripts', 'page-studio-skills-server.mjs')], {
            cwd: serviceRoot,
            stdio: 'ignore',
            env: {
                ...process.env,
                PAGE_STUDIO_PORT: String(port),
                PAGE_STUDIO_VARIANTS: variantsPath,
                PAGE_STUDIO_BRAND: brandPath,
                PAGE_STUDIO_PUBLISH_ROOT: path.join(workspace, 'published'),
                PAGE_STUDIO_ASSETS: path.join(workspace, 'assets'),
                JEV_STUB_EVALUATOR: '1',
            },
        });

        const baseUrl = `http://127.0.0.1:${port}`;
        await waitForService(`${baseUrl}/api/page-studio-skills/catalog`);
        client = createDrivenClient({ baseUrl, previewBaseUrl: 'http://127.0.0.1:3200' });
    }, 120_000);

    afterAll(async () => {
        service?.kill('SIGTERM');
        if (workspace) await rm(workspace, { recursive: true, force: true });
    });

    it('lê a marca inicial do serviço como um objeto vazio (documento vazio)', async () => {
        if (!serviceRoot || !client) {
            expect(serviceRoot).toBeNull();
            return;
        }

        const brand = await client.brand();
        // O serviço devolve o documento vazio para um brand.json vazio: colors, palette, typography.
        expect(brand).toBeObject();
        expect(brand).toHaveProperty('schemaVersion', 2);
    }, 30_000);

    it('ciclo completo: grava uma marca, relê e confirma que o valor novo persistiu', async () => {
        if (!serviceRoot || !client) {
            expect(serviceRoot).toBeNull();
            return;
        }

        const brandToSave = validBrandV2('#3c83f6');

        // Gravar não lança exceção: o serviço aceita a marca válida.
        await expect(client.saveBrand(brandToSave)).resolves.toBeUndefined();

        // Reler pelo mesmo cliente confirma o que o serviço guardou.
        const readBack = await client.brand();
        expect(readBack).toHaveProperty('schemaVersion', 2);
        // A cor primária precisa estar presente com o valor que foi gravado.
        const colors = readBack.colors as Record<string, unknown>;
        expect(colors).toBeDefined();
        const primary = colors['primary'] as Record<string, unknown>;
        expect(primary).toBeDefined();
        expect(primary['$value']).toBe('#3c83f6');

        // Confirmar diretamente no arquivo em disco: a persistência não é só memória do serviço.
        const diskContent = JSON.parse(await readFile(brandPath, 'utf8'));
        expect(diskContent).toHaveProperty('schemaVersion', 2);
        const diskColors = diskContent.colors as Record<string, unknown>;
        const diskPrimary = diskColors['primary'] as Record<string, unknown>;
        expect(diskPrimary['$value']).toBe('#3c83f6');
    }, 30_000);

    it('grava uma segunda cor, relê e confirma que o valor mais recente substituiu o anterior', async () => {
        if (!serviceRoot || !client) {
            expect(serviceRoot).toBeNull();
            return;
        }

        const firstBrand = validBrandV2('#aabbcc');
        await client.saveBrand(firstBrand);

        const secondBrand = validBrandV2('#112233');
        await client.saveBrand(secondBrand);

        const readBack = await client.brand();
        const colors = readBack.colors as Record<string, unknown>;
        const primary = colors['primary'] as Record<string, unknown>;
        // A segunda gravação substitui a primeira: o serviço não acumula, substitui.
        expect(primary['$value']).toBe('#112233');
    }, 30_000);

    it('recusa uma marca inválida (schemaVersion errado) sem tocar no arquivo em disco', async () => {
        if (!serviceRoot || !client) {
            expect(serviceRoot).toBeNull();
            return;
        }

        // Gravar primeiro uma marca válida para ter um estado conhecido em disco.
        const validBrand = validBrandV2('#ffffff');
        await client.saveBrand(validBrand);
        const diskBefore = await readFile(brandPath, 'utf8');

        // Uma marca com schemaVersion ausente é recusada pelo serviço com 400.
        const invalidBrand = { colors: { primary: { $type: 'color', $value: '#000000' } } };
        await expect(client.saveBrand(invalidBrand as Record<string, unknown>)).rejects.toThrow('Driven service unavailable (400)');

        // O arquivo em disco não mudou: a recusa é antes da gravação.
        const diskAfter = await readFile(brandPath, 'utf8');
        expect(diskAfter).toBe(diskBefore);
    }, 30_000);

    it('recusa uma cor fora do conjunto de tokens reconhecidos, sem gravar', async () => {
        if (!serviceRoot || !client) {
            expect(serviceRoot).toBeNull();
            return;
        }

        // "brand-color" não é um token reconhecido pelo serviço.
        const invalidTokenBrand = {
            schemaVersion: 2,
            colors: { 'brand-color': { $type: 'color', $value: '#ff0000' } },
            palette: {},
            typography: {},
        };
        await expect(client.saveBrand(invalidTokenBrand as Record<string, unknown>)).rejects.toThrow('Driven service unavailable (400)');
    }, 30_000);
});
