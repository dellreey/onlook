import { CodeProvider } from './providers';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
export * from './providers';
export { CodesandboxProvider } from './providers/codesandbox';
export * from './types';

/**
 * Este índice é carregado pelo browser, então ele não pode alcançar `node:fs`.
 *
 * O provider de sistema de arquivos — o do Runtime Local — mora em `@onlook/code-provider/nodefs`,
 * que é um ponto de entrada só do servidor. Aqui fica só o nome `CodeProvider.NodeFs`, para quem
 * precisa dizer de qual modo se está falando sem carregar a implementação.
 */
export const NODE_FS_ENTRY = '@onlook/code-provider/nodefs';

export interface CreateClientOptions {
    providerOptions: ProviderInstanceOptions;
}

/**
 * Providers are designed to be singletons; be mindful of this when creating multiple clients
 * or when instantiating in the backend (stateless vs stateful).
 */
export async function createCodeProviderClient(
    codeProvider: CodeProvider,
    { providerOptions }: CreateClientOptions,
) {
    const provider = newProviderInstance(codeProvider, providerOptions);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(
    codeProvider: CodeProvider,
): Promise<typeof CodesandboxProvider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        throw new Error(`The NodeFs provider is server-only. Import it from ${NODE_FS_ENTRY}.`);
    }
    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
}

function newProviderInstance(codeProvider: CodeProvider, providerOptions: ProviderInstanceOptions) {
    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        return new CodesandboxProvider(providerOptions.codesandbox);
    }

    if (codeProvider === CodeProvider.NodeFs) {
        throw new Error(`The NodeFs provider is server-only. Import it from ${NODE_FS_ENTRY}.`);
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
