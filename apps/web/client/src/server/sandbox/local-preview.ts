import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import type { LocalProject } from './local-projects';

interface LocalProcess {
    exited: Promise<number>;
    kill: () => void;
}

export interface LocalPreviewManagerOptions {
    commandForPreview: (project: LocalProject, port: number) => string[];
    firstPort?: number;
    lastPort?: number;
    isPortFree?: (port: number) => Promise<boolean>;
    startProcess?: (command: string[], projectDirectory: string) => LocalProcess;
}

export interface LocalPreview {
    url: string;
    port: number;
}

export type LocalPreviewStatus =
    | { state: 'running'; url: string; port: number }
    | { state: 'stopped' };

interface RunningPreview extends LocalPreview {
    process: LocalProcess;
}

const DEFAULT_FIRST_PORT = 4300;
const DEFAULT_LAST_PORT = 4399;

async function isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close((error) => resolve(!error));
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * O processo do preview, aberto pelo próprio servidor.
 *
 * O comando é escolhido pelo servidor — aqui ele só é obedecido. A execução passa pelo
 * `child_process`, e não pela API global do Bun: o servidor do Next roda em Node, onde essa API não
 * existe, e a chamada falhava no meio da sessão local.
 *
 * O processo é o líder do próprio grupo: encerrar o preview precisa encerrar também os filhos que
 * ele abrir, ou o `next` do projeto continua segurando a porta depois que o preview é parado.
 */
function startChildProcess(command: string[], directory: string): LocalProcess {
    const [file, ...args] = command;
    if (!file) {
        throw new Error('Local preview command cannot be empty');
    }

    const child = spawn(file, args, {
        cwd: directory,
        stdio: 'ignore',
        detached: true,
    });

    const exited = new Promise<number>((resolve) => {
        child.once('exit', (code) => resolve(code ?? 0));
        // Um comando que não existe não chega a sair: ele falha ao ser aberto. A promessa precisa
        // terminar do mesmo jeito, senão o preview fica marcado como vivo para sempre.
        child.once('error', () => resolve(1));
    });

    return {
        exited,
        kill: () => {
            if (child.pid === undefined) return;
            try {
                process.kill(-child.pid, 'SIGTERM');
            } catch {
                child.kill('SIGTERM');
            }
        },
    };
}

/** Owns local preview processes. Commands and URLs are always server-selected. */
export class LocalPreviewManager {
    private readonly previews = new Map<string, RunningPreview>();
    private readonly stoppedProjects = new Set<string>();
    private readonly firstPort: number;
    private readonly lastPort: number;
    private readonly isPortFree: (port: number) => Promise<boolean>;
    private readonly startProcess: (command: string[], projectDirectory: string) => LocalProcess;

    constructor(private readonly options: LocalPreviewManagerOptions) {
        this.firstPort = options.firstPort ?? DEFAULT_FIRST_PORT;
        this.lastPort = options.lastPort ?? DEFAULT_LAST_PORT;
        this.isPortFree = options.isPortFree ?? isPortFree;
        this.startProcess = options.startProcess ?? startChildProcess;
        registerShutdownCleanup(this);
    }

    /**
     * Encerra todos os previews vivos.
     *
     * Cada preview é o líder do próprio grupo de processos, para que `stop()` alcance também os
     * filhos que ele abrir. O preço disso é que ele **não** morre junto com o servidor que o criou:
     * sem esta limpeza, desligar o editor deixaria um dev server do projeto segurando a porta e a
     * memória da máquina. É o que aconteceu antes desta função existir — a verificação seguinte
     * encontrou a porta 4300 ocupada por um preview órfão da rodada anterior.
     */
    killAll(): void {
        for (const preview of this.previews.values()) {
            preview.process.kill();
        }
        this.previews.clear();
    }

    async start(project: LocalProject): Promise<LocalPreview> {
        const existing = this.previews.get(project.id);
        if (existing) {
            return { url: existing.url, port: existing.port };
        }

        const port = await this.allocatePort();
        const command = this.options.commandForPreview(project, port);
        if (command.length === 0) {
            throw new Error('Local preview command cannot be empty');
        }
        const process = this.startProcess(command, project.directory);
        const preview: RunningPreview = {
            url: `http://127.0.0.1:${port}`,
            port,
            process,
        };
        this.previews.set(project.id, preview);
        this.stoppedProjects.delete(project.id);
        void process.exited.finally(() => {
            if (this.previews.get(project.id) === preview) {
                this.previews.delete(project.id);
                this.stoppedProjects.add(project.id);
            }
        });
        return { url: preview.url, port: preview.port };
    }

    async stop(projectId: string): Promise<void> {
        const preview = this.previews.get(projectId);
        if (preview) {
            this.previews.delete(projectId);
            preview.process.kill();
        }
        this.stoppedProjects.add(projectId);
    }

    async restart(project: LocalProject): Promise<LocalPreview> {
        await this.stop(project.id);
        return this.start(project);
    }

    async status(projectId: string): Promise<LocalPreviewStatus> {
        const preview = this.previews.get(projectId);
        return preview
            ? { state: 'running', url: preview.url, port: preview.port }
            : { state: 'stopped' };
    }

    private async allocatePort(): Promise<number> {
        const allocated = new Set([...this.previews.values()].map((preview) => preview.port));
        for (let port = this.firstPort; port <= this.lastPort; port++) {
            if (!allocated.has(port) && (await this.isPortFree(port))) {
                return port;
            }
        }
        throw new Error('No free local preview ports are available');
    }
}

/**
 * A limpeza acontece uma vez por processo, e não uma vez por gerente.
 *
 * O gerente é criado sob demanda pelo servidor; registrar um ouvinte a cada criação deixaria
 * dezenas de ouvintes e chamadas repetidas. A referência é guardada para o encerramento alcançar o
 * gerente vivo, e não uma cópia morta dele.
 */
let cleanupRegistered = false;
const liveManagers = new Set<LocalPreviewManager>();

function registerShutdownCleanup(manager: LocalPreviewManager): void {
    liveManagers.add(manager);
    if (cleanupRegistered) return;
    cleanupRegistered = true;

    process.once('exit', () => {
        for (const live of liveManagers) live.killAll();
    });

    // Node não executa o `exit` quando o processo é terminado por sinal; sem isto, o encerramento
    // por `SIGTERM` — que é como um servidor de desenvolvimento é desligado — deixaria os previews
    // para trás. Depois da limpeza o sinal volta a valer, para o processo terminar como terminaria.
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
        process.on(signal, () => {
            for (const live of liveManagers) live.killAll();
            process.removeAllListeners(signal);
            process.kill(process.pid, signal);
        });
    }
}
