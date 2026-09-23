import { describe, expect, it } from 'bun:test';
import { getSandboxClientConfig, resolveSandboxMode } from './mode';

describe('resolveSandboxMode', () => {
    it('uses the local runtime when the projects root is configured', () => {
        expect(resolveSandboxMode({ ONLOOK_LOCAL_PROJECTS_ROOT: '/tmp/onlook-projects' })).toMatchObject({
            kind: 'local',
            capabilities: { local: true, create: true, branch: false, githubImport: false },
        });
    });

    it('requires an absolute projects root in local mode', () => {
        expect(() => resolveSandboxMode({ ONLOOK_SANDBOX_MODE: 'local' })).toThrow(
            'ONLOOK_LOCAL_PROJECTS_ROOT',
        );
    });

    it('keeps CodeSandbox explicit and does not accept unknown modes', () => {
        expect(resolveSandboxMode({ ONLOOK_SANDBOX_MODE: 'codesandbox' })).toMatchObject({
            kind: 'codesandbox',
            capabilities: { local: false, create: true, branch: true, githubImport: true },
        });
        expect(() => resolveSandboxMode({ ONLOOK_SANDBOX_MODE: 'e2b' })).toThrow(
            'ONLOOK_SANDBOX_MODE',
        );
    });

    it('exposes mode capabilities without leaking the local project root', () => {
        const clientConfig = getSandboxClientConfig({
            ONLOOK_SANDBOX_MODE: 'local',
            ONLOOK_LOCAL_PROJECTS_ROOT: '/tmp/onlook-projects',
        });

        expect(clientConfig).toEqual({
            kind: 'local',
            capabilities: {
                local: true,
                create: true,
                branch: false,
                githubImport: false,
                publish: false,
                domains: false,
            },
        });
        expect(clientConfig).not.toHaveProperty('projectRoot');
    });
});
