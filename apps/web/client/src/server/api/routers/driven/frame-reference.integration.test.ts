import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { buildVariant } from './client';
import { resolveFrameReference } from './frame-reference';
import { startSkillsService, superprojectRoot, type SkillsService } from './test-skills-service';

/**
 * A referência do quadro, conferida contra o serviço de verdade.
 *
 * A aba Driven aponta o quadro do canvas para uma página do Driven, e às vezes para uma variante
 * dela. Os dois identificadores vêm do navegador. Se a rota gravasse o que recebeu, um identificador
 * inventado passaria a valer como referência, e o quadro buscaria uma página que não existe — o
 * defeito apareceria como canvas em branco, longe de quem o causou.
 *
 * O que estes testes medem é a conferência: a página existe no sitemap, a variante é daquela página,
 * e o que volta para gravar é o identificador que o sitemap confirmou. A autorização do quadro é
 * outra responsabilidade, e tem teste próprio em `project/helper.test.ts`; o que se verifica aqui é
 * o que a rota confia ao adaptador antes de escrever.
 */

describe('Driven frame reference against the real skills service', () => {
    let service: SkillsService | null = null;
    let serviceRoot: string | null = null;

    beforeAll(async () => {
        serviceRoot = await superprojectRoot();
        if (!serviceRoot) return;

        service = await startSkillsService({
            serviceRoot,
            variants: {
                // Sem a versão de esquema o serviço responde uma bancada vazia, e a verificação
                // mediria a degradação em vez da conferência.
                schemaVersion: 1,
                pages: {
                    home: {
                        approvedVariantId: 'variant-aprovada',
                        variants: [
                            buildVariant({
                                id: 'variant-aprovada',
                                name: 'Home aprovada',
                                contentStrategy: 'template',
                                pageInstruction: 'Aprovada antes da conferência.',
                                blocks: [{ id: 'variant-aprovada-1', key: 'hero--column' }],
                            }),
                        ],
                    },
                },
            },
        });
    }, 120_000);

    afterAll(async () => {
        await service?.stop();
    });

    it('aceita a página do sitemap e uma variante que é dela', async () => {
        if (!service) {
            expect(serviceRoot).toBeNull();
            return;
        }

        const reference = await resolveFrameReference(service.client, {
            pageId: 'home',
            variantId: 'variant-aprovada',
        });

        expect(reference.pageId).toBe('home');
        expect(reference.variantId).toBe('variant-aprovada');
        expect(reference.url).toBe('http://127.0.0.1:3200/p/home/variant-aprovada?live=1');
    }, 120_000);

    it('aceita a página sem variante, e o endereço é o da página', async () => {
        if (!service) {
            expect(serviceRoot).toBeNull();
            return;
        }

        const reference = await resolveFrameReference(service.client, { pageId: 'home' });

        expect(reference.pageId).toBe('home');
        expect(reference.variantId).toBeUndefined();
        expect(reference.url).toBe('http://127.0.0.1:3200/p/home?live=1');
    }, 120_000);

    it('recusa uma página que o Driven não tem', async () => {
        if (!service) {
            expect(serviceRoot).toBeNull();
            return;
        }

        await expect(
            resolveFrameReference(service.client, { pageId: 'pagina-inexistente' }),
        ).rejects.toThrow('Driven page was not found.');
    }, 120_000);

    it('recusa uma variante que não é daquela página', async () => {
        if (!service) {
            expect(serviceRoot).toBeNull();
            return;
        }

        await expect(
            resolveFrameReference(service.client, { pageId: 'home', variantId: 'variant-inventada' }),
        ).rejects.toThrow('Driven variant was not found for this page.');
    }, 120_000);
});
