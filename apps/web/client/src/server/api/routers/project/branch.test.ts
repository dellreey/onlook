import { describe, expect, it } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import { UNSUPPORTED_IN_LOCAL_MODE } from '../../../sandbox/local-runtime';

/**
 * O branch em branco, em modo local.
 *
 * `createBlank` montava a branch nova pedindo uma sessão ao CodeSandbox
 * (`getStaticCodeProvider + createProject`) sem perguntar em que modo o servidor está. O contrato
 * do produto diz o contrário: nenhum fluxo local pode criar uma sessão CodeSandbox implicitamente.
 * O `fork` desta mesma rota já recusava pelo `rejectIfLocalMode`; aqui a mesma guarda precisa
 * valer, com a mesma mensagem, antes de qualquer trabalho.
 *
 * O router é chamado de verdade. `@/env` valida o ambiente no import, então as variáveis mínimas
 * entram antes dos imports dinâmicos do router e do contexto.
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

async function createBranchCaller() {
    const { branchRouter } = await import('./branch');
    const { createCallerFactory } = await import('../../trpc');
    const { db } = await import('@onlook/db/src/client');

    return createCallerFactory(branchRouter)({
        db,
        supabase: createClient('http://127.0.0.1:54321', 'test-anon-key'),
        user: TEST_USER,
        headers: new Headers(),
    });
}

const blankBranchInput = { projectId: '11111111-1111-4111-8111-111111111111' };

describe('branch.createBlank no modo local', () => {
    it('recusa antes de pedir uma sessão CodeSandbox', async () => {
        const caller = await createBranchCaller();

        await expect(caller.createBlank(blankBranchInput)).rejects.toThrow(
            UNSUPPORTED_IN_LOCAL_MODE,
        );
    });

    it('recusa com o código de erro do contrato', async () => {
        const caller = await createBranchCaller();

        await expect(caller.createBlank(blankBranchInput)).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
        });
    });
});
