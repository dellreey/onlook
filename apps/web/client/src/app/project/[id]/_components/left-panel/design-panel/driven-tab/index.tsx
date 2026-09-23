'use client';

import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/client';
import { Button } from '@onlook/ui/button';
import { Input } from '@onlook/ui/input';
import { Textarea } from '@onlook/ui/textarea';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { DrivenCatalogItem, DrivenPage, DrivenVariant } from '@/server/api/routers/driven/client';
import { applyDrivenFrameReference } from './frame-reference';

type Surface = 'pages' | 'templates' | 'compose' | 'variants' | 'brand';

/**
 * O sitemap, como o servidor o entrega.
 *
 * `presentUrl` chega resolvido do adaptador porque o endereço é do servidor: o browser nunca monta a
 * URL do Driven nem recebe a configuração dele. É opcional porque um sitemap mais antigo pode não
 * trazê-lo — e aí o botão fica indisponível em vez de abrir um endereço inventado.
 */
type DrivenPageWithPresent = DrivenPage & { presentUrl?: string };

export const DrivenTab = observer(() => {
    const editorEngine = useEditorEngine();
    const [surface, setSurface] = useState<Surface>('pages');
    const [pageId, setPageId] = useState<string>();
    const [variantId, setVariantId] = useState<string>();
    const [message, setMessage] = useState<string>();
    const [data, setData] = useState<{ pages: DrivenPageWithPresent[]; catalog: DrivenCatalogItem[] }>();
    const [variants, setVariants] = useState<DrivenVariant[]>([]);
    const [error, setError] = useState<string>();
    const [isLoading, setIsLoading] = useState(true);
    const [brandText, setBrandText] = useState('');
    const frame = editorEngine.frames.selected[0]?.frame;
    const limitation = editorEngine.activeSandbox.limitation;

    useEffect(() => {
        void api.driven.snapshot.query().then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Driven indisponível.')).finally(() => setIsLoading(false));
    }, []);

    useEffect(() => {
        if (!pageId) { setVariants([]); return; }
        void api.driven.variants.query({ pageId }).then(setVariants).catch((cause) => setError(cause instanceof Error ? cause.message : 'Variantes indisponíveis.'));
    }, [pageId]);

    useEffect(() => {
        void api.driven.brand.query()
            .then((brand) => setBrandText(JSON.stringify(brand, null, 2)))
            .catch((cause) => setError(cause instanceof Error ? cause.message : 'Marca Driven indisponível.'));
    }, []);

    const saveBrand = async () => {
        setMessage(undefined);
        try {
            const brand = JSON.parse(brandText) as Record<string, unknown>;
            await api.driven.saveBrand.mutate(brand);
            setMessage('Marca salva no Driven.');
        } catch (cause) {
            setMessage(cause instanceof SyntaxError ? 'A marca precisa ser um JSON válido.' : cause instanceof Error ? cause.message : 'Não foi possível salvar a marca no Driven.');
        }
    };

    const open = async (requestedPageId = pageId, requestedVariantId = variantId) => {
        if (!frame || !requestedPageId) return;
        setMessage(undefined);
        try {
            const result = await api.driven.loadFrame.mutate({ frameId: frame.id, pageId: requestedPageId, variantId: requestedVariantId });
            const currentFrame = editorEngine.frames.get(frame.id)?.frame;
            if (currentFrame) editorEngine.frames.updateInMemory(frame.id, applyDrivenFrameReference(currentFrame, result));
            setPageId(result.pageId);
            setVariantId(result.variantId);
            setMessage('Carregado no canvas. A composição continua salva no Driven.');
        } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : 'Não foi possível carregar a página do Driven.');
        }
    };
    const compose = async () => {
        if (!frame || !pageId) return;
        setMessage(undefined);
        try {
            const result = await api.driven.compose.mutate({ frameId: frame.id, pageId, prompt: 'Compose a new page variant from the Driven catalog.' });
            const currentFrame = editorEngine.frames.get(frame.id)?.frame;
            if (currentFrame) editorEngine.frames.updateInMemory(frame.id, applyDrivenFrameReference(currentFrame, result));
            setPageId(result.pageId);
            setVariantId(result.variantId);
            setMessage('Nova variante JEV criada no Driven e carregada no canvas.');
        } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível compor com JEV.'); }
    };
    const approve = async (id: string) => {
        if (!pageId) return;
        if (!frame) return;
        try { await api.driven.approve.mutate({ frameId: frame.id, pageId, variantId: id }); setMessage('Variante aprovada no Driven.'); }
        catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível aprovar a variante.'); }
    };
    const applyTemplate = async (componentId: string) => {
        if (!frame || !pageId) return;
        try {
            const result = await api.driven.applyTemplate.mutate({ frameId: frame.id, pageId, componentId });
            const currentFrame = editorEngine.frames.get(frame.id)?.frame;
            if (currentFrame) editorEngine.frames.updateInMemory(frame.id, applyDrivenFrameReference(currentFrame, result));
            setPageId(result.pageId);
            setVariantId(result.variantId);
            setMessage('Template aplicado em uma nova variante do Driven.');
        } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível aplicar o template.'); }
    };

    if (isLoading) return <div className="p-3 text-xs text-muted-foreground">Carregando Driven…</div>;
    if (error) return <div className="p-3 text-xs text-destructive">{error}</div>;

    /**
     * Abrir a página no endereço dela, e não no rascunho do canvas.
     *
     * O endereço já veio pronto do servidor, então a aba abre no próprio clique — pedir a URL depois
     * de um `await` faria o navegador tratar a aba como pop-up e bloqueá-la. O `noopener` mantém a
     * aba nova sem acesso a esta janela.
     */
    const present = (url?: string) => {
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-xs" data-testid="driven-tab">
        {limitation && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200" data-testid="driven-runtime-limitation">
                {limitation}
            </p>
        )}
        <div className="grid grid-cols-2 gap-1">
            {([['pages', 'Páginas'], ['templates', 'Templates'], ['compose', 'Composição'], ['variants', 'Variantes'], ['brand', 'Marca Driven']] as const).map(([value, label]) =>
                <Button key={value} size="sm" variant={surface === value ? 'default' : 'ghost'} onClick={() => setSurface(value)}>{label}</Button>,
            )}
        </div>
        {!frame && <p className="text-muted-foreground">Selecione um frame para abrir uma página do Driven.</p>}
        {surface === 'pages' && <div className="space-y-2">
            {(data?.pages ?? []).map((page: DrivenPageWithPresent) => <div key={page.id} data-testid={`driven-page-${page.id}`} className="rounded border p-2">
                <p className="font-medium">{page.title ?? page.id}</p><p className="text-muted-foreground">{page.slug}</p>
                <Button className="mt-2 w-full" size="sm" onClick={() => { setPageId(page.id); setVariantId(undefined); void open(page.id); }} disabled={!frame}>Abrir no canvas</Button>
                <Button className="mt-1 w-full" size="sm" variant="ghost" data-testid={`present-${page.id}`} onClick={() => present(page.presentUrl)} disabled={!page.presentUrl}>Present</Button>
            </div>)}
        </div>}
        {surface === 'templates' && <div className="space-y-2">
            <Input placeholder="ID da página Driven" value={pageId ?? ''} onChange={(event) => setPageId(event.target.value)} />
            <p className="text-muted-foreground">O catálogo é lido do Driven. Cada aplicação cria uma variante nova.</p>
            {(data?.catalog ?? []).map((item: DrivenCatalogItem) => <div key={item.componentId} data-testid={`driven-template-${item.componentId}`} className="rounded border p-2"><p>{item.label ?? item.componentId}</p><Button className="mt-2 w-full" size="sm" onClick={() => void applyTemplate(item.componentId)} disabled={!frame || !pageId}>Aplicar à nova variante</Button></div>)}
        </div>}
        {surface === 'compose' && <div className="space-y-2">
            <p>Compor cria uma variante no Driven; nunca altera uma variante aprovada.</p>
            <Input placeholder="Página (por exemplo: home)" value={pageId ?? ''} onChange={(event) => setPageId(event.target.value)} />
            <Button onClick={() => void compose()} disabled={!frame || !pageId}>Compor com JEV</Button>
            <p className="text-muted-foreground">A operação cria uma variante nova no Driven; não inicia uma sessão CodeSandbox.</p>
        </div>}
        {surface === 'variants' && <div className="space-y-2">
            <Input placeholder="ID da página Driven" value={pageId ?? ''} onChange={(event) => { setPageId(event.target.value); setVariantId(undefined); }} />
            {variants.map((variant: DrivenVariant) => <div key={variant.id} data-testid={`driven-variant-${variant.id}`} className="rounded border p-2">
                <p>{variant.name ?? variant.id}</p><p className="text-muted-foreground">{variant.id}</p>
                <Button className="mt-2 w-full" size="sm" onClick={() => { setVariantId(variant.id); void open(pageId, variant.id); }} disabled={!frame}>Carregar no canvas</Button>
                <Button className="mt-1 w-full" size="sm" variant="ghost" onClick={() => void approve(variant.id)}>Aprovar no Driven</Button>
            </div>)}
        </div>}
        {surface === 'brand' && <div className="space-y-2">
            <p className="text-muted-foreground">A marca abaixo é lida e salva exclusivamente no Driven. A marca nativa do Onlook não é alterada.</p>
            <Textarea className="min-h-64 font-mono text-xs" value={brandText} onChange={(event) => setBrandText(event.target.value)} aria-label="Marca Driven JSON" />
            <Button className="w-full" size="sm" onClick={() => void saveBrand()}>Salvar no Driven</Button>
        </div>}
        {/* O identificador existe para a verificação de ponta a ponta medir a mensagem da ação — e não o
            container inteiro da aba, que sempre contém a palavra "salva" no parágrafo estático acima. */}
        {message && <p className="text-muted-foreground" data-testid="driven-message">{message}</p>}
    </div>;
});
