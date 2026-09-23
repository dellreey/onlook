import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
    CodeProvider,
    createCodeProviderClient,
    getStaticCodeProvider,
} from '@onlook/code-provider';
import { getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';
import { shortenUuid } from '@onlook/utility/src/id';

import { createTRPCRouter, protectedProcedure } from '../../trpc';
import { getSandboxClientConfig } from '../../../sandbox/mode';
import { listAccessibleSandboxIds, verifySandboxAccess } from './helper';
import { getLocalRuntime, UNSUPPORTED_IN_LOCAL_MODE } from '../../../sandbox/local-runtime';

function localMode() {
    return getSandboxClientConfig().kind === 'local';
}

function unsupportedLocal(): never {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: UNSUPPORTED_IN_LOCAL_MODE });
}

function getProvider({
    sandboxId,
    userId,
    provider = CodeProvider.CodeSandbox,
}: {
    sandboxId: string;
    provider?: CodeProvider;
    userId?: undefined | string;
}) {
    if (provider === CodeProvider.CodeSandbox) {
        return createCodeProviderClient(CodeProvider.CodeSandbox, {
            providerOptions: {
                codesandbox: {
                    sandboxId,
                    userId,
                },
            },
        });
    }
    throw new Error('NodeFs providers are created only by the local runtime');
}

export const sandboxRouter = createTRPCRouter({
    capabilities: protectedProcedure.query(() => getSandboxClientConfig()),
    localSession: protectedProcedure
        .input(z.object({ sandboxId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            if (!localMode()) unsupportedLocal();
            const project = await getLocalRuntime().registry.get(ctx.user.id, input.sandboxId);
            if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
            const preview = await getLocalRuntime().previews.start(project);
            return {
                sandboxId: project.id,
                provider: 'node_fs' as const,
                previewUrl: preview.url,
                capabilities: getSandboxClientConfig().capabilities,
            };
        }),
    localFile: protectedProcedure
        .input(z.object({
            sandboxId: z.string(),
            operation: z.enum(['read', 'write', 'list', 'stat', 'delete', 'rename', 'copy', 'mkdir']),
            path: z.string().optional(),
            content: z.string().optional(),
            oldPath: z.string().optional(),
            newPath: z.string().optional(),
            sourcePath: z.string().optional(),
            targetPath: z.string().optional(),
            recursive: z.boolean().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            if (!localMode()) unsupportedLocal();
            const project = await getLocalRuntime().registry.get(ctx.user.id, input.sandboxId);
            if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
            const provider = await getLocalRuntime().provider(project);
            try {
                switch (input.operation) {
                    case 'read': return await provider.readFile({ args: { path: input.path ?? '' } });
                    case 'write': return await provider.writeFile({ args: { path: input.path ?? '', content: input.content ?? '' } });
                    case 'list': return await provider.listFiles({ args: { path: input.path ?? '.' } });
                    case 'stat': return await provider.statFile({ args: { path: input.path ?? '' } });
                    case 'delete': return await provider.deleteFiles({ args: { path: input.path ?? '', recursive: input.recursive } });
                    case 'rename': return await provider.renameFile({ args: { oldPath: input.oldPath ?? '', newPath: input.newPath ?? '' } });
                    case 'copy': return await provider.copyFiles({ args: { sourcePath: input.sourcePath ?? '', targetPath: input.targetPath ?? '', recursive: input.recursive } });
                    case 'mkdir': return await provider.createDirectory({ args: { path: input.path ?? '' } });
                }
            } finally {
                await provider.destroy();
            }
        }),
    create: protectedProcedure
        .input(
            z.object({
                title: z.string().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            if (localMode()) {
                const project = await getLocalRuntime().registry.create(
                    ctx.user.id,
                    input.title || 'Onlook Local Project',
                );
                const preview = await getLocalRuntime().previews.start(project);
                return {
                    sandboxId: project.id,
                    provider: 'node_fs' as const,
                    previewUrl: preview.url,
                };
            }
            // Create a new sandbox using the static provider
            const CodesandboxProvider = await getStaticCodeProvider(CodeProvider.CodeSandbox);

            // Use the empty Next.js template
            const template = SandboxTemplates[Templates.EMPTY_NEXTJS];

            const newSandbox = await CodesandboxProvider.createProject({
                source: 'template',
                id: template.id,
                title: input.title || 'Onlook Test Sandbox',
                description: 'Test sandbox for Onlook sync engine',
                tags: ['onlook-test'],
            });

            return {
                sandboxId: newSandbox.id,
                previewUrl: getSandboxPreviewUrl(newSandbox.id, template.port),
            };
        }),

    start: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const userId = ctx.user.id;
            if (localMode()) {
                const project = await getLocalRuntime().registry.get(userId, input.sandboxId);
                if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
                const preview = await getLocalRuntime().previews.start(project);
                return {
                    provider: 'node_fs' as const,
                    sandboxId: project.id,
                    previewUrl: preview.url,
                    capabilities: getSandboxClientConfig().capabilities,
                };
            }
            await verifySandboxAccess(ctx.db, userId, input.sandboxId);
            const provider = await getProvider({
                sandboxId: input.sandboxId,
                userId,
            });
            const session = await provider.createSession({
                args: {
                    id: shortenUuid(userId, 20),
                },
            });
            await provider.destroy();
            return session;
        }),
    hibernate: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            if (localMode()) {
                const project = await getLocalRuntime().registry.get(ctx.user.id, input.sandboxId);
                if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
                await getLocalRuntime().previews.stop(project.id);
                return;
            }
            await verifySandboxAccess(ctx.db, ctx.user.id, input.sandboxId);
            const provider = await getProvider({ sandboxId: input.sandboxId });
            try {
                await provider.pauseProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
    list: protectedProcedure.input(z.object({ sandboxId: z.string() })).query(async ({ input, ctx }) => {
        await verifySandboxAccess(ctx.db, ctx.user.id, input.sandboxId);
        const provider = await getProvider({ sandboxId: input.sandboxId });
        const res = await provider.listProjects({});
        // TODO future iteration of code provider abstraction will need this code to be refactored
        if ('projects' in res) {
            // `listProjects` returns the entire account's sandboxes. Scope the
            // result to the caller's own so this can't enumerate other tenants'
            // sandboxes (the input id doesn't constrain the provider output).
            const accessible = await listAccessibleSandboxIds(ctx.db, ctx.user.id);
            const projectList = res.projects as Array<{ id: string }>;
            return projectList.filter((project) => accessible.has(project.id));
        }
        return [];
    }),
    fork: protectedProcedure
        .input(
            z.object({
                sandbox: z.object({
                    id: z.string(),
                    port: z.number(),
                }),
                config: z
                    .object({
                        title: z.string().optional(),
                        tags: z.array(z.string()).optional(),
                    })
                    .optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            if (localMode()) unsupportedLocal();
            // Forking a sandbox tied to another user's project would clone their
            // source tree. Templates / fresh sandboxes resolve to no project and
            // are allowed (blank-project + local-import flows fork a template).
            await verifySandboxAccess(ctx.db, ctx.user.id, input.sandbox.id);
            const MAX_RETRY_ATTEMPTS = 3;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    const CodesandboxProvider = await getStaticCodeProvider(
                        CodeProvider.CodeSandbox,
                    );
                    const sandbox = await CodesandboxProvider.createProject({
                        source: 'template',
                        id: input.sandbox.id,

                        // Metadata
                        title: input.config?.title,
                        tags: input.config?.tags,
                    });

                    const previewUrl = getSandboxPreviewUrl(sandbox.id, input.sandbox.port);

                    return {
                        sandboxId: sandbox.id,
                        previewUrl,
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt < MAX_RETRY_ATTEMPTS) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 1000),
                        );
                    }
                }
            }

            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to create sandbox after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
                cause: lastError,
            });
        }),
    delete: protectedProcedure
        .input(
            z.object({
                sandboxId: z.string(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            if (localMode()) {
                const project = await getLocalRuntime().registry.get(ctx.user.id, input.sandboxId);
                if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
                await getLocalRuntime().previews.stop(project.id);
                await getLocalRuntime().registry.delete(ctx.user.id, project.id);
                return;
            }
            await verifySandboxAccess(ctx.db, ctx.user.id, input.sandboxId);
            const provider = await getProvider({ sandboxId: input.sandboxId });
            try {
                await provider.stopProject({});
            } finally {
                await provider.destroy().catch(() => {});
            }
        }),
    createFromGitHub: protectedProcedure
        .input(
            z.object({
                repoUrl: z.string(),
                branch: z.string(),
            }),
        )
        .mutation(async ({ input }) => {
            if (localMode()) unsupportedLocal();
            const MAX_RETRY_ATTEMPTS = 3;
            const DEFAULT_PORT = 3000;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                try {
                    const CodesandboxProvider = await getStaticCodeProvider(
                        CodeProvider.CodeSandbox,
                    );
                    const sandbox = await CodesandboxProvider.createProjectFromGit({
                        repoUrl: input.repoUrl,
                        branch: input.branch,
                    });

                    const previewUrl = getSandboxPreviewUrl(sandbox.id, DEFAULT_PORT);

                    return {
                        sandboxId: sandbox.id,
                        previewUrl,
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    if (attempt < MAX_RETRY_ATTEMPTS) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 1000),
                        );
                    }
                }
            }

            throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `Failed to create GitHub sandbox after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError?.message}`,
                cause: lastError,
            });
        }),
});
