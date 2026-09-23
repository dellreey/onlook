import { api } from '@/trpc/client';
import type { Provider } from '@onlook/code-provider';

type LocalFileArgs = {
    operation: 'read' | 'write' | 'list' | 'stat' | 'delete' | 'rename' | 'copy' | 'mkdir';
    path?: string;
    content?: string;
    oldPath?: string;
    newPath?: string;
    sourcePath?: string;
    targetPath?: string;
    recursive?: boolean;
};

/** Browser-side transport. It contains no filesystem or process implementation. */
export class LocalSandboxProvider {
    constructor(private readonly sandboxId: string) {}

    private file<T>(args: LocalFileArgs): Promise<T> {
        return api.sandbox.localFile.mutate({ sandboxId: this.sandboxId, ...args }) as Promise<T>;
    }

    writeFile(input: { args: { path: string; content: string | Uint8Array; overwrite?: boolean } }) {
        if (input.args.content instanceof Uint8Array) throw new Error('Binary local files are unsupported');
        return this.file({ operation: 'write', path: input.args.path, content: input.args.content });
    }
    readFile(input: { args: { path: string } }) { return this.file({ operation: 'read', path: input.args.path }); }
    listFiles(input: { args: { path: string } }) { return this.file({ operation: 'list', path: input.args.path }); }
    statFile(input: { args: { path: string } }) { return this.file({ operation: 'stat', path: input.args.path }); }
    deleteFiles(input: { args: { path: string; recursive?: boolean } }) { return this.file({ operation: 'delete', ...input.args }); }
    renameFile(input: { args: { oldPath: string; newPath: string } }) { return this.file({ operation: 'rename', ...input.args }); }
    copyFiles(input: { args: { sourcePath: string; targetPath: string; recursive?: boolean } }) { return this.file({ operation: 'copy', ...input.args }); }
    createDirectory(input: { args: { path: string } }) { return this.file({ operation: 'mkdir', path: input.args.path }); }

    unsupported(): never { throw new Error('UNSUPPORTED_IN_LOCAL_MODE'); }
    destroy = async () => {};
    initialize = async () => ({});
    setup = async () => ({});
    reload = async () => true;
    reconnect = async () => {};
    ping = async () => true;
    downloadFiles = async () => ({ url: undefined });
    gitStatus = async () => ({ changedFiles: [] });
    createTerminal = async () => this.unsupported();
    getTask = async () => this.unsupported();
    runCommand = async () => this.unsupported();
    runBackgroundCommand = async () => this.unsupported();
    watchFiles = async () => this.unsupported();
    pauseProject = async () => this.unsupported();
    stopProject = async () => this.unsupported();
    listProjects = async () => this.unsupported();
    createSession = async () => this.unsupported();

    asProvider(): Provider { return this as unknown as Provider; }
}
