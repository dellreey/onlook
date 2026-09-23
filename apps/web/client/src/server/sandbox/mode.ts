import path from 'node:path';

export interface SandboxCapabilities {
    local: boolean;
    create: boolean;
    branch: boolean;
    githubImport: boolean;
    publish: boolean;
    domains: boolean;
}

export interface LocalSandboxModeConfig {
    kind: 'local';
    projectRoot: string;
    capabilities: SandboxCapabilities;
}

export interface CodeSandboxModeConfig {
    kind: 'codesandbox';
    capabilities: SandboxCapabilities;
}

export type SandboxModeConfig = LocalSandboxModeConfig | CodeSandboxModeConfig;

/**
 * The only sandbox configuration safe to return to a browser. In particular,
 * `projectRoot` stays server-only even while local mode is active.
 */
export interface SandboxClientConfig {
    kind: SandboxModeConfig['kind'];
    capabilities: SandboxCapabilities;
}

type SandboxEnvironment = {
    ONLOOK_SANDBOX_MODE?: string;
    ONLOOK_LOCAL_PROJECTS_ROOT?: string;
};

function currentSandboxEnvironment(): SandboxEnvironment {
    return {
        ONLOOK_SANDBOX_MODE: process.env.ONLOOK_SANDBOX_MODE,
        ONLOOK_LOCAL_PROJECTS_ROOT: process.env.ONLOOK_LOCAL_PROJECTS_ROOT,
    };
}

const LOCAL_CAPABILITIES: SandboxCapabilities = Object.freeze({
    local: true,
    create: true,
    branch: false,
    githubImport: false,
    publish: false,
    domains: false,
});

const CODESANDBOX_CAPABILITIES: SandboxCapabilities = Object.freeze({
    local: false,
    create: true,
    branch: true,
    githubImport: true,
    publish: true,
    domains: true,
});

function requireAbsoluteProjectRoot(root: string | undefined): string {
    if (!root || !path.isAbsolute(root)) {
        throw new Error('ONLOOK_LOCAL_PROJECTS_ROOT must be an absolute path in local mode');
    }

    return path.resolve(root);
}

export function resolveSandboxMode(
    environment: SandboxEnvironment = currentSandboxEnvironment(),
): SandboxModeConfig {
    const configuredMode = environment.ONLOOK_SANDBOX_MODE;
    if (configuredMode && configuredMode !== 'local' && configuredMode !== 'codesandbox') {
        throw new Error('ONLOOK_SANDBOX_MODE must be either local or codesandbox');
    }

    const localRoot = environment.ONLOOK_LOCAL_PROJECTS_ROOT;
    if (configuredMode === 'local' || (!configuredMode && localRoot)) {
        return {
            kind: 'local',
            projectRoot: requireAbsoluteProjectRoot(localRoot),
            capabilities: LOCAL_CAPABILITIES,
        };
    }

    return {
        kind: 'codesandbox',
        capabilities: CODESANDBOX_CAPABILITIES,
    };
}

export function getSandboxClientConfig(
    environment: SandboxEnvironment = currentSandboxEnvironment(),
): SandboxClientConfig {
    const { kind, capabilities } = resolveSandboxMode(environment);
    return { kind, capabilities };
}
