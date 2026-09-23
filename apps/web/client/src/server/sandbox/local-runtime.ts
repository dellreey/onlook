import { createNodeFsProvider } from '@onlook/code-provider/nodefs';
import { TRPCError } from '@trpc/server';
import { LocalProjectRegistry, type LocalProject } from './local-projects';
import { LocalPreviewManager } from './local-preview';
import { resolveSandboxMode } from './mode';

export const UNSUPPORTED_IN_LOCAL_MODE = 'UNSUPPORTED_IN_LOCAL_MODE';

let runtime: LocalRuntime | undefined;

export class LocalRuntime {
    readonly registry: LocalProjectRegistry;
    readonly previews: LocalPreviewManager;

    constructor(root: string, templateDirectory: string) {
        this.registry = new LocalProjectRegistry({ projectsRoot: root, templateDirectory });
        this.previews = new LocalPreviewManager({
            commandForPreview: (_project, port) => [
                'bun', 'run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(port),
            ],
        });
    }

    async provider(project: LocalProject) {
        // O provider vive atrás do ponto de entrada do servidor: o índice do pacote é carregado
        // também pelo browser, e um `node:fs` alcançável a partir dali quebra o bundle do cliente.
        return createNodeFsProvider({ projectRoot: project.directory });
    }
}

export function getLocalRuntime(): LocalRuntime {
    const mode = resolveSandboxMode();
    if (mode.kind !== 'local') {
        throw new Error('Local runtime is unavailable in CodeSandbox mode');
    }
    const template = process.env.ONLOOK_LOCAL_TEMPLATE_DIR;
    if (!template) {
        throw new Error('ONLOOK_LOCAL_TEMPLATE_DIR is required in local mode');
    }
    return (runtime ??= new LocalRuntime(mode.projectRoot, template));
}

export function unsupportedInLocalMode(): never {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: UNSUPPORTED_IN_LOCAL_MODE });
}

export function rejectIfLocalMode(): void {
    if (resolveSandboxMode().kind === 'local') unsupportedInLocalMode();
}

export function resetLocalRuntimeForTests(): void {
    runtime = undefined;
}
