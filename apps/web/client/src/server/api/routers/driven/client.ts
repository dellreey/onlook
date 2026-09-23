export type DrivenFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export type DrivenPage = { id: string; slug: string; title?: string; pageType?: string };
export type DrivenCatalogItem = { componentId: string; label?: string; category?: string; defaultProps?: Record<string, unknown> };
export type DrivenVariant = { id: string; name?: string; approvedAt?: string | null };
export type DrivenBrand = Record<string, unknown>;
type DrivenVariantStore = { pages?: Record<string, { variants?: unknown[] }> };

type DrivenClientOptions = {
    baseUrl: string;
    previewBaseUrl?: string;
    fetch?: DrivenFetch;
};

/**
 * A forma de uma variante, como o serviço do Driven a aceita.
 *
 * Um bloco precisa de id e key; a variante precisa de id, name, a lista de blocks, o template com
 * key e props, e o metadata. O serviço recusa o que não tem essa forma com 400, antes de gravar —
 * é ele quem decide, e o adaptador não pode descobrir isso pela resposta de erro.
 *
 * A montagem fica aqui, e não dentro das rotas, porque é a mesma forma para as duas portas da
 * criação: aplicar um template do catálogo e compor pelo Jev. Quem escreve a variante usa esta
 * função, e é ela que a verificação contra o serviço de verdade exercita.
 */
export type DrivenVariantBlock = { id: string; key: string; props?: Record<string, unknown> };

export const buildVariant = (input: {
    id: string;
    name: string;
    pageType?: string;
    blocks: DrivenVariantBlock[];
    contentStrategy: 'jev-composition' | 'template';
    pageInstruction: string;
    templateKey?: string;
}): Record<string, unknown> => ({
    id: input.id,
    name: input.name,
    pageType: input.pageType ?? 'landing',
    template: { key: input.templateKey ?? 'landing--jev', props: {} },
    nodeData: { x: 0, y: 0 },
    blocks: input.blocks.map((block, index) => ({
        id: block.id,
        key: block.key,
        props: block.props ?? {},
        slot: `section-${index + 1}`,
    })),
    metadata: {
        contentStrategy: input.contentStrategy,
        pageInstruction: input.pageInstruction,
    },
});

export class DrivenServiceError extends Error {
    constructor(status: number) {
        super(`Driven service unavailable (${status})`);
    }
}

export const createDrivenClient = ({
    baseUrl,
    previewBaseUrl = 'http://127.0.0.1:3200',
    fetch: fetchImplementation = fetch,
}: DrivenClientOptions) => {
    const serviceUrl = new URL('/api/page-studio-skills/', baseUrl).toString();

    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        let response: Response;
        try {
            response = await fetchImplementation(new URL(path, serviceUrl), init);
        } catch {
            throw new DrivenServiceError(503);
        }
        if (!response.ok) throw new DrivenServiceError(response.status);
        return response.json() as Promise<T>;
    };

    return {
        async pages(): Promise<DrivenPage[]> {
            const response = await request<{ catalog?: { pages?: DrivenPage[] } }>('catalog/primeui');
            return (response.catalog?.pages ?? []).map((page) => ({
                ...page,
                id: page.slug === '/' ? 'home' : page.slug.replace(/^\//, ''),
            }));
        },
        async catalog(): Promise<DrivenCatalogItem[]> {
            const response = await request<{ catalog?: { items?: DrivenCatalogItem[] } }>('catalog/primeui');
            return response.catalog?.items ?? [];
        },
        async variants(pageId: string): Promise<DrivenVariant[]> {
            const response = await request<{ store?: { pages?: Record<string, { variants?: DrivenVariant[] }> } }>('variants');
            return response.store?.pages?.[pageId]?.variants ?? [];
        },
        async variantStore(): Promise<DrivenVariantStore> {
            const response = await request<{ store?: DrivenVariantStore }>('variants');
            return response.store ?? {};
        },
        async brand(): Promise<DrivenBrand> {
            const response = await request<{ brand?: DrivenBrand }>('brand');
            return response.brand ?? {};
        },
        async saveBrand(brand: DrivenBrand): Promise<void> {
            await request('brand', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(brand),
            });
        },
        async saveVariants(pageId: string, variants: unknown[]): Promise<void> {
            await request('variants', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, variants }) });
        },
        async approve(pageId: string, variantId: string): Promise<void> {
            await request('variants/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, variantId }) });
        },
        async compose(input: { pageSlug: string; prompt?: string }): Promise<{ blocks: Array<{ key: string; props?: Record<string, unknown> }> }> {
            return request('compose', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(input),
            });
        },
        previewUrl(pageId: string, variantId?: string): string {
            const page = encodeURIComponent(pageId);
            const variant = variantId ? `/${encodeURIComponent(variantId)}` : '';
            return new URL(`/p/${page}${variant}?live=1`, previewBaseUrl).toString();
        },
        /**
         * O endereço onde a página responde para quem só vai olhar.
         *
         * Sem `?live=1` e sem variante: apresentar não é conferir. A rota publicada serve o que foi
         * publicado e, quando ainda não há publicação, mostra o rascunho — quem decide isso é a rota do
         * Driven, não a interface. Por isso não há aqui um "apresentar esta variante": uma variante que
         * ainda não foi aprovada não ganha endereço de apresentação.
         */
        presentUrl(pageId: string): string {
            return new URL(`/p/${encodeURIComponent(pageId)}`, previewBaseUrl).toString();
        },
    };
};
