import { CodeProviderSync } from '@/services/sync-engine/sync-engine';
import type { Provider } from '@onlook/code-provider';
import { EXCLUDED_SYNC_PATHS } from '@onlook/constants';
import type { CodeFileSystem } from '@onlook/file-system';
import { type FileEntry } from '@onlook/file-system';
import type { Branch, RouterConfig } from '@onlook/models';
import { makeAutoObservable, reaction } from 'mobx';
import type { EditorEngine } from '../engine';
import type { ErrorManager } from '../error';
import { GitManager } from '../git';
import { detectRouterConfig } from '../pages/helper';
import { copyPreloadScriptToPublic, getLayoutPath as detectLayoutPath } from './preload-script';
import { SessionManager } from './session';

export enum PreloadScriptState {
    NOT_INJECTED = 'not-injected',
    LOADING = 'loading',
    INJECTED = 'injected'
}

/**
 * A capacidade ausente do Runtime Local, em uma frase que a interface pode mostrar.
 *
 * O runtime local abre o projeto, o preview e o canvas a partir de uma raiz da máquina. O que ele
 * não tem é o processo que roda e observa o projeto — terminal, observação de arquivos e o dev
 * server —, e é por isso que a edição de código exige uma sessão de execução.
 */
export const LOCAL_RUNTIME_LIMITATION =
    'Edição de código, terminal e observação de arquivos exigem uma sessão de execução. O Runtime Local abre o projeto, o preview e o canvas.';
export class SandboxManager {
    readonly session: SessionManager;
    readonly gitManager: GitManager;
    private providerReactionDisposer?: () => void;
    private sync: CodeProviderSync | null = null;
    preloadScriptState: PreloadScriptState = PreloadScriptState.NOT_INJECTED
    routerConfig: RouterConfig | null = null;

    /**
     * O que este runtime não oferece, dito em uma frase, para a interface poder mostrar.
     *
     * O Runtime Local não observa arquivos nem abre terminal — isso é do sandbox de execução. A
     * limitação fica registrada aqui em vez de virar uma rejeição sem dono: quem olha o editor
     * precisa saber que a edição de código exige uma sessão de execução, e o resto do editor
     * continua funcionando normalmente.
     */
    limitation: string | null = null;

    constructor(
        private branch: Branch,
        private readonly editorEngine: EditorEngine,
        private readonly errorManager: ErrorManager,
        private readonly fs: CodeFileSystem,
    ) {
        this.session = new SessionManager(this.branch, this.errorManager);
        this.gitManager = new GitManager(this);
        makeAutoObservable(this);
    }

    async init() {
        // Start connection asynchronously (don't wait)
        if (!this.session.provider) {
            this.session.start(this.branch.sandbox.id).catch(err => {
                console.error('[SandboxManager] Initial connection failed:', err);
                // Don't throw - let reaction handle retries/reconnects
            });
        }

        // React to provider becoming available (now or later)
        this.providerReactionDisposer = reaction(
            () => this.session.provider,
            async (provider) => {
                try {
                    if (provider) {
                        await this.initializeSyncEngine(provider);
                        // O histórico de código é operado por comandos (`git init`, `git status`), e
                        // comandos são do sandbox de execução. No Runtime Local não há terminal: abrir
                        // o repositório aqui falharia em toda abertura de projeto e mostraria esse erro
                        // a quem só abriu o editor. A ausência fica dita, e não tentada.
                        if (this.session.mode !== 'local') {
                            await this.gitManager.init();
                        }
                    } else if (this.sync) {
                        // If the provider is null, release the sync engine reference
                        this.sync.release();
                        this.sync = null;
                    }
                } catch (error) {
                    // Uma reação do MobX não tem quem espere por ela: deixar o erro subir vira
                    // `unhandledRejection` no navegador, que não diz nada a quem está usando o
                    // editor. O que falhou fica registrado e visível.
                    this.limitation =
                        error instanceof Error ? error.message : 'Falha ao preparar a edição de código.';
                    console.error('[SandboxManager] Sync unavailable:', error);
                }
            },
            { fireImmediately: true },
        );
    }

    async getRouterConfig(): Promise<RouterConfig | null> {
        if (!!this.routerConfig) {
            return this.routerConfig;
        }
        if (!this.session.provider) {
            throw new Error('Provider not initialized');
        }
        this.routerConfig = await detectRouterConfig(this.session.provider);
        return this.routerConfig;
    }

    async initializeSyncEngine(provider: Provider) {
        if (this.sync) {
            this.sync.release();
            this.sync = null;
        }

        // O observador é do sandbox de execução. No Runtime Local não existe processo observando o
        // projeto, e pedir o observador falharia em toda abertura sem devolver nenhuma capacidade:
        // a leitura inicial dos arquivos continua vindo do `pullFromSandbox`, dentro do `start()`.
        const localMode = this.session.mode === 'local';

        this.sync = CodeProviderSync.getInstance(provider, this.fs, this.branch.sandbox.id, {
            exclude: EXCLUDED_SYNC_PATHS,
            watch: !localMode,
        });

        try {
            await this.sync.start();
            this.limitation = localMode ? LOCAL_RUNTIME_LIMITATION : null;
        } catch (error) {
            // Sem observação de arquivos não há sincronização bidirecional. O sandbox local não a
            // oferece, e isso é uma capacidade ausente — e não um erro do projeto aberto. As demais
            // etapas (preload e índice de arquivos) seguem, porque não dependem do observador.
            this.limitation =
                error instanceof Error
                    ? `Edição de código e terminal exigem uma sessão de execução (${error.message}).`
                    : 'Edição de código e terminal exigem uma sessão de execução.';
        }
        await this.ensurePreloadScriptExists();
        await this.fs.rebuildIndex();
    }

    private async ensurePreloadScriptExists(): Promise<void> {
        try {
            if (this.preloadScriptState !== PreloadScriptState.NOT_INJECTED
            ) {
                return;
            }

            this.preloadScriptState = PreloadScriptState.LOADING

            if (!this.session.provider) {
                throw new Error('No provider available for preload script injection');
            }

            const routerConfig = await this.getRouterConfig();
            if (!routerConfig) {
                throw new Error('No router config found for preload script injection');
            }

            await copyPreloadScriptToPublic(this.session.provider, routerConfig);
            this.preloadScriptState = PreloadScriptState.INJECTED
        } catch (error) {
            if (this.session.mode === 'local') {
                // Sem raiz de rotas não há onde injetar o preload, e isso não impede abrir a página:
                // quem serve o projeto é o processo de quem o roda, não o editor.
                this.limitation = LOCAL_RUNTIME_LIMITATION;
                console.info(
                    '[SandboxManager] Preload script não injetado no Runtime Local:',
                    error instanceof Error ? error.message : error,
                );
            } else {
                console.error('[SandboxManager] Failed to ensure preload script exists:', error);
            }
            // Mark as injected to prevent blocking frames indefinitely
            // Frames will handle the missing preload script gracefully
            this.preloadScriptState = PreloadScriptState.NOT_INJECTED
        }
    }

    async getLayoutPath(): Promise<string | null> {
        const routerConfig = await this.getRouterConfig();
        if (!routerConfig) {
            return null;
        }
        return detectLayoutPath(routerConfig, (path) => this.fileExists(path));
    }

    get errors() {
        return this.errorManager.errors;
    }

    get syncEngine() {
        return this.sync;
    }

    async readFile(path: string): Promise<string | Uint8Array> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readFile(path);
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.writeFile(path, content);
    }

    listAllFiles() {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listAll();
    }

    async readDir(dir: string): Promise<FileEntry[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readDirectory(dir);
    }

    async listFilesRecursively(dir: string): Promise<string[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listFiles(dir);
    }

    async fileExists(path: string): Promise<boolean> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs?.exists(path);
    }

    async copyFile(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyFile(path, targetPath);
    }

    async copyDirectory(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyDirectory(path, targetPath);
    }

    async deleteFile(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteFile(path);
    }

    async deleteDirectory(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteDirectory(path);
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.moveFile(oldPath, newPath);
    }

    // Download the code as a zip
    async downloadFiles(
        projectName?: string,
    ): Promise<{ downloadUrl: string; fileName: string } | null> {
        if (!this.session.provider) {
            console.error('No sandbox provider found for download');
            return null;
        }
        try {
            const { url } = await this.session.provider.downloadFiles({
                args: {
                    path: './',
                },
            });
            return {
                // in case there is no URL provided then the code must be updated
                // to handle this case
                downloadUrl: url ?? '',
                fileName: `${projectName ?? 'onlook-project'}-${Date.now()}.zip`,
            };
        } catch (error) {
            console.error('Error generating download URL:', error);
            return null;
        }
    }

    clear() {
        this.providerReactionDisposer?.();
        this.providerReactionDisposer = undefined;
        this.sync?.release();
        this.sync = null;
        this.preloadScriptState = PreloadScriptState.NOT_INJECTED
        this.session.clear();
    }
}
