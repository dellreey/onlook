import { frames } from '@onlook/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { verifyFrameAccess } from '../project/helper';
import { createDrivenClient, DrivenServiceError, type DrivenBrand } from './client';
import { resolveFrameReference } from './frame-reference';
import { applyTemplateNewVariant, composeNewVariant } from './variant-creation';

const driven = () => createDrivenClient({
    baseUrl: process.env.DRIVEN_BASE_URL ?? 'http://127.0.0.1:4310',
    previewBaseUrl: process.env.DRIVEN_PREVIEW_BASE_URL ?? 'http://127.0.0.1:3200',
});

const unavailable = (error: unknown): never => {
    if (error instanceof DrivenServiceError) throw new Error(error.message);
    throw error;
};

export const drivenRouter = createTRPCRouter({
    snapshot: protectedProcedure.query(async () => {
        try {
            const client = driven();
            const [pages, catalog] = await Promise.all([client.pages(), client.catalog()]);
            // O endereço de apresentação vem resolvido do servidor junto com o sitemap: o botão
            // Present abre uma aba nova no clique, e uma aba nova pedida depois de um `await` é uma
            // aba que o navegador bloqueia. O browser continua sem saber onde o serviço do Driven mora.
            return { pages: pages.map((page) => ({ ...page, presentUrl: client.presentUrl(page.id) })), catalog };
        } catch (error) {
            return unavailable(error);
        }
    }),
    variants: protectedProcedure.input(z.object({ pageId: z.string().min(1) })).query(async ({ input }) => {
        try {
            return await driven().variants(input.pageId);
        } catch (error) {
            return unavailable(error);
        }
    }),
    brand: protectedProcedure.query(async () => {
        try {
            return await driven().brand();
        } catch (error) {
            return unavailable(error);
        }
    }),
    saveBrand: protectedProcedure.input(z.record(z.string(), z.unknown())).mutation(async ({ input }) => {
        try {
            await driven().saveBrand(input as DrivenBrand);
            return true;
        } catch (error) {
            return unavailable(error);
        }
    }),
    loadFrame: protectedProcedure.input(z.object({
        frameId: z.uuid(),
        pageId: z.string().min(1),
        variantId: z.string().min(1).optional(),
    })).mutation(async ({ ctx, input }) => {
        await verifyFrameAccess(ctx.db, ctx.user.id, input.frameId);
        try {
            // A conferência da página e da variante fica fora da rota, onde é verificável sem banco e
            // sem sessão. Aqui fica o que é da rota: autorizar o quadro de quem pediu e gravar a
            // referência nele — com o identificador da página que o sitemap confirmou, e não com o
            // texto que o navegador mandou.
            const reference = await resolveFrameReference(driven(), input);
            await ctx.db.update(frames).set({
                url: reference.url,
                drivenPageId: reference.pageId,
                drivenVariantId: reference.variantId ?? null,
            }).where(eq(frames.id, input.frameId));
            return reference;
        } catch (error) {
            return unavailable(error);
        }
    }),
    compose: protectedProcedure.input(z.object({ frameId: z.uuid(), pageId: z.string().min(1), prompt: z.string().optional() })).mutation(async ({ ctx, input }) => {
        await verifyFrameAccess(ctx.db, ctx.user.id, input.frameId);
        try {
            // A criação da variante — compor, acrescentar, montar o endereço — fica fora da rota,
            // onde é verificável sem banco e sem sessão. Aqui fica o que é da rota: autorizar o
            // quadro de quem pediu e apontar esse quadro para a variante nova.
            const { id, url, pageId, variantId } = await composeNewVariant(driven(), {
                pageId: input.pageId,
                prompt: input.prompt,
            });
            await ctx.db.update(frames).set({ url, drivenPageId: pageId, drivenVariantId: variantId }).where(eq(frames.id, input.frameId));
            return { id, url, pageId, variantId };
        } catch (error) { return unavailable(error); }
    }),
    applyTemplate: protectedProcedure.input(z.object({ frameId: z.uuid(), pageId: z.string().min(1), componentId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
        await verifyFrameAccess(ctx.db, ctx.user.id, input.frameId);
        try {
            const { id, url, pageId, variantId } = await applyTemplateNewVariant(driven(), {
                pageId: input.pageId,
                componentId: input.componentId,
            });
            await ctx.db.update(frames).set({ url, drivenPageId: pageId, drivenVariantId: variantId }).where(eq(frames.id, input.frameId));
            return { id, url, pageId, variantId };
        } catch (error) { return unavailable(error); }
    }),
    approve: protectedProcedure.input(z.object({ frameId: z.uuid(), pageId: z.string().min(1), variantId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
        await verifyFrameAccess(ctx.db, ctx.user.id, input.frameId);
        try { await driven().approve(input.pageId, input.variantId); return true; }
        catch (error) { return unavailable(error); }
    }),
});
