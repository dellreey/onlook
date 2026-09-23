import { describe, expect, it } from 'bun:test';
import { forkBuildSandbox } from './fork';
import { UNSUPPORTED_IN_LOCAL_MODE } from '../../../../sandbox/local-runtime';

/**
 * O sandbox de build da publicação.
 *
 * `forkBuildSandbox` é o ponto exato onde o caminho do Publish depende do CodeSandbox: ele pede o
 * provider e cria um projeto novo. Em modo local isso não pode ser tentado, nem aqui nem por quem
 * chamar esta função no futuro.
 *
 * O segundo caso fixa o outro lado da guarda: a recusa vale só quando `ONLOOK_SANDBOX_MODE=local`.
 * No modo CodeSandbox o caminho continua seguindo para o provider — a falha que aparece ali é a
 * ausência de credencial do CodeSandbox, não a guarda local.
 */
process.env.ONLOOK_SANDBOX_MODE = 'local';
process.env.ONLOOK_LOCAL_PROJECTS_ROOT = '/tmp/onlook-projects';
delete process.env.CSB_API_KEY;

describe('forkBuildSandbox no modo local', () => {
    it('recusa antes de pedir o provider CodeSandbox', async () => {
        await expect(forkBuildSandbox('sandbox-1', 'user-1', 'deployment-1')).rejects.toThrow(
            UNSUPPORTED_IN_LOCAL_MODE,
        );
    });

    it('não interfere no modo CodeSandbox', async () => {
        process.env.ONLOOK_SANDBOX_MODE = 'codesandbox';
        delete process.env.ONLOOK_LOCAL_PROJECTS_ROOT;

        const failure = await forkBuildSandbox('sandbox-1', 'user-1', 'deployment-1').catch(
            (error: unknown) => error,
        );

        expect(String(failure)).not.toContain(UNSUPPORTED_IN_LOCAL_MODE);

        process.env.ONLOOK_SANDBOX_MODE = 'local';
        process.env.ONLOOK_LOCAL_PROJECTS_ROOT = '/tmp/onlook-projects';
    });
});
