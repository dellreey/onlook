import type { createDrivenClient } from './client';

export type DrivenClient = ReturnType<typeof createDrivenClient>;

export type ResolvedFrameReference = {
    /** O identificador da página, como o serviço do Driven o guarda. */
    pageId: string;
    /** O identificador da variante, quando a referência aponta para uma. */
    variantId?: string;
    /** O endereço do preview, montado pelo adaptador a partir da rota viva. */
    url: string;
};

/**
 * A referência de um quadro, resolvida contra o Driven antes de ser gravada.
 *
 * A rota que aponta o quadro para o Driven recebe um identificador de página e, às vezes, o de uma
 * variante. Os dois vêm do navegador, então nenhum dos dois é confiável: a rota precisa conferir
 * que a página existe no sitemap e que a variante é daquela página antes de escrever a referência.
 *
 * Essa conferência estava escrita dentro do manipulador, onde a única forma de exercitá-la era
 * levantar o editor inteiro, com banco e sessão. Aqui ela é o que se executa, e o que a verificação
 * contra o serviço de verdade mede. O que continua sendo da rota é o que só a rota tem: autorizar o
 * quadro de quem pediu e gravar a referência nele.
 *
 * A página é aceita pelo identificador ou pelo caminho — o sitemap do Driven tem os dois, e quem
 * escreve a referência pode ter qualquer um dos dois em mãos. O que é gravado é sempre o
 * identificador, para que a leitura não dependa de qual dos dois foi usado na escrita.
 */
export async function resolveFrameReference(
    client: DrivenClient,
    input: { pageId: string; variantId?: string },
): Promise<ResolvedFrameReference> {
    const pages = await client.pages();
    const page = pages.find(
        (candidate) =>
            candidate.id === input.pageId || candidate.slug.replace(/^\//, '') === input.pageId,
    );
    if (!page) throw new Error('Driven page was not found.');

    if (input.variantId) {
        const variants = await client.variants(page.id);
        if (!variants.some((variant) => variant.id === input.variantId)) {
            throw new Error('Driven variant was not found for this page.');
        }
    }

    return {
        pageId: page.id,
        variantId: input.variantId,
        url: client.previewUrl(page.id, input.variantId),
    };
}
