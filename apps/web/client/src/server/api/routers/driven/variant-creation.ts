import { buildVariant, type createDrivenClient } from './client';

export type DrivenClient = ReturnType<typeof createDrivenClient>;

export type CreatedVariant = {
    /** O identificador da variante nova, como o serviço do Driven a guarda. */
    id: string;
    pageId: string;
    variantId: string;
    /** O endereço do preview dela, montado pelo adaptador. */
    url: string;
};

/** O relógio e o gerador de identificador são injetados para o teste não depender do tempo real. */
type CreationOptions = {
    now?: () => number;
};

const defaultNow = () => Date.now();

/**
 * As duas portas que criam variante — o Jev e o template —, fora da rota.
 *
 * A ordem é a regra do produto, e ela estava escrita dentro do manipulador da rota: ler o catálogo
 * ou compor, ler o depósito, **acrescentar** a variante nova ao que já existe, e só então montar o
 * endereço do preview. Enquanto isso vivia na rota, a única forma de conferir era levantar o
 * editor inteiro, com banco e sessão; e um teste que reescrevesse a mesma ordem mediria a cópia, e
 * não o produto.
 *
 * Aqui a ordem é o que se executa, e o que a verificação exercita. O que continua sendo da rota é
 * o que só a rota tem: autorizar o quadro de quem pediu e gravar a referência nele.
 */

/** A composição do Jev: a página decide o catálogo, o serviço decide as seções, a variante é nova. */
export async function composeNewVariant(
    client: DrivenClient,
    input: { pageId: string; prompt?: string },
    options: CreationOptions = {},
): Promise<CreatedVariant> {
    const page = (await client.pages()).find((item) => item.id === input.pageId);
    if (!page) throw new Error('Driven page was not found.');

    const composition = await client.compose({ pageSlug: page.slug, prompt: input.prompt });
    // Uma composição sem seções não é uma página: gravar uma variante vazia apagaria o quadro e
    // ainda pareceria sucesso. A recusa é dita aqui, e não descoberta na tela em branco.
    if (composition.blocks.length === 0) throw new Error('Driven returned no composable sections.');

    const now = options.now ?? defaultNow;
    const id = `onlook-jev-${now()}`;
    const store = await client.variantStore();
    const variant = buildVariant({
        id,
        name: `JEV ${new Date(now()).toISOString()}`,
        pageType: page.pageType,
        contentStrategy: 'jev-composition',
        pageInstruction: input.prompt ?? '',
        blocks: composition.blocks.map((block, index) => ({
            id: `${id}-${index + 1}`,
            key: block.key,
            props: block.props ?? {},
        })),
    });

    await appendVariant(client, input.pageId, store.pages?.[input.pageId]?.variants ?? [], variant);
    return { id, pageId: input.pageId, variantId: id, url: client.previewUrl(input.pageId, id) };
}

/** O template do catálogo: uma seção aplicada vira uma variante nova, na mesma linha. */
export async function applyTemplateNewVariant(
    client: DrivenClient,
    input: { pageId: string; componentId: string },
    options: CreationOptions = {},
): Promise<CreatedVariant> {
    const [pages, catalog, store] = await Promise.all([
        client.pages(),
        client.catalog(),
        client.variantStore(),
    ]);
    const page = pages.find((item) => item.id === input.pageId);
    const template = catalog.find((item) => item.componentId === input.componentId);
    if (!page) throw new Error('Driven page was not found.');
    if (!template) throw new Error('Driven template was not found.');

    const now = options.now ?? defaultNow;
    const id = `onlook-template-${now()}`;
    const variant = buildVariant({
        id,
        name: template.label ?? template.componentId,
        pageType: page.pageType,
        contentStrategy: 'template',
        pageInstruction: `Applied ${template.componentId} from the Driven catalog.`,
        blocks: [{ id: `${id}-1`, key: template.componentId, props: template.defaultProps ?? {} }],
    });

    await appendVariant(client, input.pageId, store.pages?.[input.pageId]?.variants ?? [], variant);
    return { id, pageId: input.pageId, variantId: id, url: client.previewUrl(input.pageId, id) };
}

/**
 * A gravação é sempre um acréscimo.
 *
 * Compor de novo cria uma variante nova; nunca substitui uma existente nem uma aprovada. É a
 * diferença entre um editor que perde trabalho e um que acumula versões — e por isso a lista que
 * vai para o serviço é a que foi lida agora, com a nova no fim.
 */
async function appendVariant(
    client: DrivenClient,
    pageId: string,
    existing: unknown[],
    variant: Record<string, unknown>,
): Promise<void> {
    await client.saveVariants(pageId, [...existing, variant]);
}
