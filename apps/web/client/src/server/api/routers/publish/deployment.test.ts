import { describe, expect, it } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import { DeploymentType } from '@onlook/models';
import { UNSUPPORTED_IN_LOCAL_MODE } from '../../../sandbox/local-runtime';

/**
 * O Publish, em modo local.
 *
 * A publicação é criada e depois executada: o `run` chama `publish`, que forka o sandbox de build
 * (`getStaticCodeProvider + createCodeProviderClient + createProject`) — ou seja, o caminho inteiro
 * depende de uma sessão CodeSandbox. Em modo local ele seguia adiante assim mesmo, marcava o
 * deployment como em andamento e só falhava dentro do CodeSandbox. O contrato do produto diz que
 * `publish` é uma capacidade local `false`: aqui o `run` precisa recusar de saída, com a mesma
 * mensagem que o resto do repositório já usa.
 */
Object.assign(process.env, {
    NODE_ENV: 'test',
    SUPABASE_DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    OPENROUTER_API_KEY: 'test-openrouter-key',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    ONLOOK_SANDBOX_MODE: 'local',
    ONLOOK_LOCAL_PROJECTS_ROOT: '/tmp/onlook-projects',
});
delete process.env.CSB_API_KEY;

const TEST_USER = {
    id: 'user-1',
    email: 'user@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
};

async function createDeploymentCaller() {
    const { deploymentRouter } = await import('./deployment');
    const { createCallerFactory } = await import('../../trpc');
    const { db } = await import('@onlook/db/src/client');

    return createCallerFactory(deploymentRouter)({
        db,
        supabase: createClient('http://127.0.0.1:54321', 'test-anon-key'),
        user: TEST_USER,
        headers: new Headers(),
    });
}

const runInput = { deploymentId: '00000000-0000-0000-0000-000000000002' };
const createInput = {
    projectId: '22222222-2222-4222-8222-222222222222',
    type: DeploymentType.PREVIEW,
    sandboxId: 'sandbox-1',
};

describe('publish.deployment.create no modo local', () => {
    it('recusa antes de registrar um deployment que só o CodeSandbox poderia executar', async () => {
        const caller = await createDeploymentCaller();

        await expect(caller.create(createInput)).rejects.toThrow(UNSUPPORTED_IN_LOCAL_MODE);
    });
});

describe('publish.deployment.run no modo local', () => {
    it('recusa antes de forkar o sandbox de build', async () => {
        const caller = await createDeploymentCaller();

        await expect(caller.run(runInput)).rejects.toThrow(UNSUPPORTED_IN_LOCAL_MODE);
    });

    it('recusa com o código de erro do contrato', async () => {
        const caller = await createDeploymentCaller();

        await expect(caller.run(runInput)).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
        });
    });
});
