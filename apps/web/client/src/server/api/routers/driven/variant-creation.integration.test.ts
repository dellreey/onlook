import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { buildVariant } from './client';
import { type SkillsService, startSkillsService, superprojectRoot } from './test-skills-service';
import { applyTemplateNewVariant, composeNewVariant } from './variant-creation';

/**
 * As duas portas da criação de variante, contra o serviço de verdade.
 *
 * A aba Driven oferece "Aplicar à nova variante" e "Compor com JEV", e as duas terminam no mesmo
 * lugar: uma variante nova no depósito do Driven, ao lado das que já existiam. Um dublê provaria
 * que o cliente sabe montar um corpo de requisição; não provaria que o serviço aceita esse corpo
 * nem que a composição que volta tem seções que o renderizador conhece.
 *
 * O serviço, o HTTP e o adaptador são os do produto, mas o avaliador é substituído pelo dublê
 * determinístico (`JEV_STUB_EVALUATOR`) para não depender de rede nem de credencial, e o depósito
 * de variantes é temporário para não escrever na bancada de quem trabalha. O que se executa é o
 * código do produto — `composeNewVariant` e `applyTemplateNewVariant` —, e não uma reescrita da
 * ordem dele. O que **não** se executa é o Jev de verdade: estes casos provam que o adaptador e o
 * serviço aceitam o que a composição devolve, não que a composição real funciona.
 */

/** A variante aprovada, na forma que o serviço exige — ele valida a lista inteira antes de gravar. */
const approvedVariant = () =>
    buildVariant({
        id: 'variant-aprovada',
        name: 'Home aprovada',
        contentStrategy: 'template',
        pageInstruction: 'Aprovada antes da criação.',
        blocks: [{ id: 'variant-aprovada-1', key: 'hero--column' }],
    });

describe('Driven variant creation against the real skills service', () => {
    let service: SkillsService | null = null;
    let serviceRoot: string | null = null;
    let variantsPath = '';

    beforeAll(async () => {
        serviceRoot = await superprojectRoot();
        if (!serviceRoot) return;

        service = await startSkillsService({
            serviceRoot,
            variants: {
                // Sem a versão de esquema o serviço responde uma bancada vazia — a degradação que
                // ele promete para um arquivo truncado —, e a verificação mediria isso em vez da
                // criação.
                schemaVersion: 1,
                // O depósito começa com uma variante aprovada: ela é a testemunha de que criar
                // acrescenta. A instrução do produto é que nem o template nem o Jev substituem uma
                // variante aprovada.
                pages: { home: { approvedVariantId: 'variant-aprovada', variants: [approvedVariant()] } },
            },
        });
        variantsPath = service.variantsPath;
    }, 120_000);

    afterAll(async () => {
        await service?.stop();
    });

    it('compõe a Home pelo dublê do Jev e acrescenta a variante, sem tocar na aprovada', async () => {
        if (!service) {
            // Sem o serviço, um teste verde seria uma afirmação sem lastro.
            expect(serviceRoot).toBeNull();
            return;
        }

        const created = await composeNewVariant(service.client, { pageId: 'home', prompt: 'Compor a Home.' });

        expect(created.id).toMatch(/^onlook-jev-\d+$/);
        expect(created.url).toBe(`http://127.0.0.1:3200/p/home/${created.id}?live=1`);

        const ids = (await service.client.variants('home')).map((variant) => variant.id);
        expect(ids).toEqual(['variant-aprovada', created.id]);
    }, 120_000);

    it('a variante composta pelo dublê usa seções do catálogo, e guarda o rastro da composição', async () => {
        if (!service) {
            expect(serviceRoot).toBeNull();
            return;
        }

        const created = await composeNewVariant(service.client, { pageId: 'home', prompt: 'Compor a Home.' });
        const written = JSON.parse(await readFile(variantsPath, 'utf8'));
        const variant = written.pages.home.variants.find((item: { id: string }) => item.id === created.id);

        // O dublê do avaliador escolhe a resposta entre as opções que o compositor preparou a partir
        // do catálogo, então esta asserção é verdadeira por construção enquanto ele estiver ligado:
        // ela prova que o serviço aceitou e gravou o que o compositor mandou, não que uma seção fora
        // do catálogo seria recusada. O defeito real — uma seção que o renderizador não conhece,
        // chegando ao quadro em branco longe de quem compôs — só apareceria com o Jev de verdade ou
        // com um dublê capaz de devolver uma chave fora do catálogo.
        const catalogKeys = new Set((await service.client.catalog()).map((item) => item.componentId));
        expect(variant.blocks.length).toBeGreaterThan(0);
        for (const block of variant.blocks) {
            expect(catalogKeys.has(block.key)).toBe(true);
        }
        expect(variant.metadata.contentStrategy).toBe('jev-composition');
    }, 120_000);

    it('aplica um template do catálogo como variante nova, e a aprovada continua aprovada', async () => {
        if (!service) {
            expect(serviceRoot).toBeNull();
            return;
        }

        const [template] = await service.client.catalog();
        expect(template).toBeDefined();

        const created = await applyTemplateNewVariant(service.client, {
            pageId: 'home',
            componentId: template!.componentId,
        });

        expect(created.id).toMatch(/^onlook-template-\d+$/);

        const written = JSON.parse(await readFile(variantsPath, 'utf8'));
        const ids = written.pages.home.variants.map((item: { id: string }) => item.id);
        expect(ids).toContain('variant-aprovada');
        expect(ids).toContain(created.id);
        expect(written.pages.home.approvedVariantId).toBe('variant-aprovada');

        const applied = written.pages.home.variants.find((item: { id: string }) => item.id === created.id);
        expect(applied.blocks.map((block: { key: string }) => block.key)).toEqual([template!.componentId]);
    }, 120_000);

    it('recusa uma página que o Driven não tem, em vez de gravar numa página inventada', async () => {
        if (!service) {
            expect(serviceRoot).toBeNull();
            return;
        }

        await expect(composeNewVariant(service.client, { pageId: 'pagina-inexistente' })).rejects.toThrow(
            'Driven page was not found.',
        );
        await expect(
            applyTemplateNewVariant(service.client, { pageId: 'home', componentId: 'secao-inexistente' }),
        ).rejects.toThrow('Driven template was not found.');
    }, 120_000);
});
