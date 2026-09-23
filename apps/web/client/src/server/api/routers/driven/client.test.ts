import { describe, expect, it } from 'bun:test';
import { createDrivenClient } from './client';

describe('Driven service adapter', () => {
    it('maps the Driven document, catalog, and variant store without exposing its base URL', async () => {
        const calls: string[] = [];
        const client = createDrivenClient({
            baseUrl: 'http://127.0.0.1:4310/',
            fetch: async (input) => {
                calls.push(String(input));
                const body = String(input).endsWith('/catalog/primeui')
                    ? { catalog: { pages: [{ id: 'home', slug: '/' }], items: [{ componentId: 'hero' }] } }
                        : { store: { pages: { home: { variants: [{ id: 'home--a' }] } } } };
                return new Response(JSON.stringify(body), { status: 200 });
            },
        });

        await expect(client.pages()).resolves.toEqual([{ id: 'home', slug: '/' }]);
        await expect(client.catalog()).resolves.toEqual([{ componentId: 'hero' }]);
        await expect(client.variants('home')).resolves.toEqual([{ id: 'home--a' }]);
        expect(calls).toEqual([
            'http://127.0.0.1:4310/api/page-studio-skills/catalog/primeui',
            'http://127.0.0.1:4310/api/page-studio-skills/catalog/primeui',
            'http://127.0.0.1:4310/api/page-studio-skills/variants',
        ]);
    });

    it('turns an unavailable service into a safe adapter error', async () => {
        const client = createDrivenClient({
            baseUrl: 'http://127.0.0.1:4310',
            fetch: async () => new Response('offline', { status: 503 }),
        });

        await expect(client.pages()).rejects.toThrow('Driven service unavailable (503)');
    });

    it('turns a network failure into the same safe adapter error', async () => {
        const client = createDrivenClient({
            baseUrl: 'http://127.0.0.1:4310',
            fetch: async () => { throw new TypeError('connection refused'); },
        });

        await expect(client.pages()).rejects.toThrow('Driven service unavailable (503)');
    });

    it('builds a live preview URL with an optional variant', () => {
        const client = createDrivenClient({ baseUrl: 'http://127.0.0.1:4310', previewBaseUrl: 'http://127.0.0.1:3200' });

        expect(client.previewUrl('home')).toBe('http://127.0.0.1:3200/p/home?live=1');
        expect(client.previewUrl('home', 'home--a')).toBe('http://127.0.0.1:3200/p/home/home--a?live=1');
    });

    it('builds the presented address without a live flag or a variant', () => {
        const client = createDrivenClient({ baseUrl: 'http://127.0.0.1:4310', previewBaseUrl: 'http://127.0.0.1:3200' });

        // Apresentar é a página no endereço dela: nada de `?live=1` e nada de variante, porque quem
        // recebe o link não escolhe o que está no ar. O rascunho só aparece quando nada foi publicado,
        // e quem decide isso é a própria rota publicada, não a interface.
        expect(client.presentUrl('home')).toBe('http://127.0.0.1:3200/p/home');
        expect(client.presentUrl('privacy-policy')).toBe('http://127.0.0.1:3200/p/privacy-policy');
    });

    it('sends composition requests to the Driven service, never the browser preview', async () => {
        let call: { url: string; method?: string; body?: string } | undefined;
        const client = createDrivenClient({
            baseUrl: 'http://127.0.0.1:4310',
            fetch: async (input, init) => {
                call = { url: String(input), method: init?.method, body: String(init?.body) };
                return new Response(JSON.stringify({ blocks: [] }), { status: 200 });
            },
        });

        await expect(client.compose({ pageSlug: '/', prompt: 'new home' })).resolves.toEqual({ blocks: [] });
        expect(call).toEqual({
            url: 'http://127.0.0.1:4310/api/page-studio-skills/compose',
            method: 'POST',
            body: JSON.stringify({ pageSlug: '/', prompt: 'new home' }),
        });
    });

    it('reads and writes the Driven brand through the skills API', async () => {
        const calls: Array<{ url: string; method?: string; body?: string }> = [];
        const brand = { palette: { brand: { '500': '#3c83f6' } }, colors: { primary: '#3c83f6' } };
        const client = createDrivenClient({
            baseUrl: 'http://127.0.0.1:4310',
            fetch: async (input, init) => {
                calls.push({ url: String(input), method: init?.method, body: String(init?.body ?? '') });
                return new Response(JSON.stringify({ brand }), { status: 200 });
            },
        });

        await expect(client.brand()).resolves.toEqual(brand);
        await expect(client.saveBrand(brand)).resolves.toBeUndefined();
        expect(calls).toEqual([
            { url: 'http://127.0.0.1:4310/api/page-studio-skills/brand', method: undefined, body: '' },
            { url: 'http://127.0.0.1:4310/api/page-studio-skills/brand', method: 'PUT', body: JSON.stringify(brand) },
        ]);
    });
});
