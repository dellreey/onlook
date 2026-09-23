import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
    type CopyFileOutput,
    type CopyFilesInput,
    type CreateDirectoryInput,
    type CreateDirectoryOutput,
    type CreateProjectInput,
    type CreateProjectOutput,
    type CreateSessionInput,
    type CreateSessionOutput,
    type CreateTerminalInput,
    type CreateTerminalOutput,
    type DeleteFilesInput,
    type DeleteFilesOutput,
    type DownloadFilesInput,
    type DownloadFilesOutput,
    type GetTaskInput,
    type GetTaskOutput,
    type GitStatusInput,
    type GitStatusOutput,
    type InitializeInput,
    type InitializeOutput,
    type ListFilesInput,
    type ListFilesOutput,
    type ListProjectsInput,
    type ListProjectsOutput,
    type PauseProjectInput,
    type PauseProjectOutput,
    type ReadFileInput,
    type ReadFileOutput,
    type RenameFileInput,
    type RenameFileOutput,
    type SetupInput,
    type SetupOutput,
    type StatFileInput,
    type StatFileOutput,
    type StopProjectInput,
    type StopProjectOutput,
    type TerminalBackgroundCommandInput,
    type TerminalBackgroundCommandOutput,
    type TerminalCommandInput,
    type TerminalCommandOutput,
    type WatchEvent,
    type WatchFilesInput,
    type WatchFilesOutput,
    type WriteFileInput,
    type WriteFileOutput,
} from '../../types';
import {
    copyFile,
    cp,
    lstat,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { resolveProjectPath } from './path';

export interface NodeFsProviderOptions {
    projectRoot: string;
}

export class NodeFsProvider extends Provider {
    private readonly options: NodeFsProviderOptions;

    constructor(options: NodeFsProviderOptions) {
        super();
        this.options = options;
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        await resolveProjectPath(this.options.projectRoot, '.');
        return {};
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const target = await resolveProjectPath(this.options.projectRoot, input.args.path);
        await writeFile(target, input.args.content, {
            flag: input.args.overwrite === false ? 'wx' : 'w',
        });
        return {
            success: true,
        };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        const oldPath = await resolveProjectPath(this.options.projectRoot, input.args.oldPath);
        const newPath = await resolveProjectPath(this.options.projectRoot, input.args.newPath);
        await rename(oldPath, newPath);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const target = await resolveProjectPath(this.options.projectRoot, input.args.path);
        const stats = await lstat(target);
        return {
            type: stats.isDirectory() ? 'directory' : 'file',
            isSymlink: stats.isSymbolicLink(),
            size: stats.size,
            mtime: stats.mtimeMs,
            ctime: stats.ctimeMs,
            atime: stats.atimeMs,
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const target = await resolveProjectPath(this.options.projectRoot, input.args.path);
        await rm(target, { recursive: input.args.recursive ?? false, force: false });
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const target = await resolveProjectPath(this.options.projectRoot, input.args.path);
        let entries: Dirent[] = [];
        try {
            entries = await readdir(target, { withFileTypes: true });
        } catch (error) {
            // O editor pergunta por diretórios que podem não existir — ao detectar a raiz de rotas,
            // por exemplo. "Não há nada aqui" é a resposta para um diretório ausente; deixar o
            // `ENOENT` subir transforma essa pergunta em erro de servidor a cada abertura de projeto.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        return {
            files: entries.map((entry) => ({
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file',
                isSymlink: entry.isSymbolicLink(),
            })),
        };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const target = await resolveProjectPath(this.options.projectRoot, input.args.path);
        const content = await readFile(target, 'utf8');
        return {
            file: {
                path: input.args.path,
                content,
                type: 'text',
                toString: () => {
                    return content;
                },
            },
        };
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        return {
            url: '',
        };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        const source = await resolveProjectPath(this.options.projectRoot, input.args.sourcePath);
        const target = await resolveProjectPath(this.options.projectRoot, input.args.targetPath);
        const sourceStats = await lstat(source);
        if (sourceStats.isDirectory()) {
            await cp(source, target, {
                recursive: input.args.recursive ?? false,
                force: input.args.overwrite ?? true,
                errorOnExist: input.args.overwrite === false,
            });
        } else {
            if (input.args.overwrite === false) {
                await copyFile(source, target, 1);
            } else {
                await copyFile(source, target);
            }
        }
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        const target = await resolveProjectPath(this.options.projectRoot, input.args.path);
        // Criar um diretório que já existe não é conflito: quem chama quer garantir que ele exista.
        await mkdir(target, { recursive: true });
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        return {
            watcher: new NodeFsFileWatcher(),
        };
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        return {
            terminal: new NodeFsTerminal(),
        };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        return {
            task: new NodeFsTask(),
        };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        return {
            output: '',
        };
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        return {
            command: new NodeFsCommand(),
        };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        return {
            changedFiles: [],
        };
    }

    async setup(input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        // TODO: Implement
        return true;
    }

    async reconnect(): Promise<void> {
        // TODO: Implement
    }

    async ping(): Promise<boolean> {
        return true;
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        return {
            id: input.id,
        };
    }

    static async createProjectFromGit(input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        throw new Error('createProjectFromGit not implemented for NodeFs provider');
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        return {};
    }

    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        return {};
    }

    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        return {};
    }

    async destroy(): Promise<void> {
        // TODO: Implement
    }
}

export class NodeFsFileWatcher extends ProviderFileWatcher {
    start(input: WatchFilesInput): Promise<void> {
        return Promise.resolve();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        // TODO: Implement
    }
}

export class NodeFsTerminal extends ProviderTerminal {
    get id(): string {
        return 'unimplemented';
    }

    get name(): string {
        return 'unimplemented';
    }

    open(): Promise<string> {
        return Promise.resolve('');
    }

    write(): Promise<void> {
        return Promise.resolve();
    }

    run(): Promise<void> {
        return Promise.resolve();
    }

    kill(): Promise<void> {
        return Promise.resolve();
    }

    onOutput(callback: (data: string) => void): () => void {
        return () => {};
    }
}

export class NodeFsTask extends ProviderTask {
    get id(): string {
        return 'unimplemented';
    }

    get name(): string {
        return 'unimplemented';
    }

    get command(): string {
        return 'unimplemented';
    }

    open(): Promise<string> {
        return Promise.resolve('');
    }

    run(): Promise<void> {
        return Promise.resolve();
    }

    restart(): Promise<void> {
        return Promise.resolve();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    onOutput(callback: (data: string) => void): () => void {
        return () => {};
    }
}

export class NodeFsCommand extends ProviderBackgroundCommand {
    get name(): string {
        return 'unimplemented';
    }

    get command(): string {
        return 'unimplemented';
    }

    open(): Promise<string> {
        return Promise.resolve('');
    }

    restart(): Promise<void> {
        return Promise.resolve();
    }

    kill(): Promise<void> {
        return Promise.resolve();
    }

    onOutput(callback: (data: string) => void): () => void {
        return () => {};
    }
}
