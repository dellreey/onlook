import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export interface LocalProject {
    id: string;
    ownerId: string;
    title: string;
    directory: string;
    createdAt: string;
}

interface LocalProjectRecord {
    id: string;
    ownerId: string;
    title: string;
    createdAt: string;
}

export interface LocalProjectRegistryOptions {
    projectsRoot: string;
    templateDirectory: string;
}

const PROJECT_ID = /^[a-z0-9-]+$/;

/** Server-only owner-scoped registry for projects backed by the local runtime. */
export class LocalProjectRegistry {
    private readonly projectDirectories: string;
    private readonly registryPath: string;
    private writes: Promise<void> = Promise.resolve();

    constructor(private readonly options: LocalProjectRegistryOptions) {
        this.projectDirectories = path.join(options.projectsRoot, 'projects');
        this.registryPath = path.join(options.projectsRoot, '.onlook-local-projects.json');
    }

    async create(ownerId: string, title: string): Promise<LocalProject> {
        return this.serialized(async () => {
            await mkdir(this.projectDirectories, { recursive: true });
            const id = randomUUID().toLowerCase();
            const directory = path.join(this.projectDirectories, id);
            await cp(this.options.templateDirectory, directory, { recursive: true, errorOnExist: true });

            const record: LocalProjectRecord = {
                id,
                ownerId,
                title,
                createdAt: new Date().toISOString(),
            };
            const records = await this.readRecords();
            records.push(record);
            await this.writeRecords(records);
            return this.toProject(record);
        });
    }

    async list(ownerId: string): Promise<LocalProject[]> {
        const records = await this.readRecords();
        return records.filter((record) => record.ownerId === ownerId).map((record) => this.toProject(record));
    }

    async get(ownerId: string, id: string): Promise<LocalProject | null> {
        if (!PROJECT_ID.test(id)) {
            return null;
        }
        const records = await this.readRecords();
        const record = records.find((candidate) => candidate.id === id && candidate.ownerId === ownerId);
        return record ? this.toProject(record) : null;
    }

    async delete(ownerId: string, id: string): Promise<boolean> {
        if (!PROJECT_ID.test(id)) {
            return false;
        }
        return this.serialized(async () => {
            const records = await this.readRecords();
            const index = records.findIndex(
                (record) => record.id === id && record.ownerId === ownerId,
            );
            if (index === -1) {
                return false;
            }

            const record = records[index]!;
            await rm(this.toProject(record).directory, { recursive: true, force: true });
            records.splice(index, 1);
            await this.writeRecords(records);
            return true;
        });
    }

    private async serialized<T>(operation: () => Promise<T>): Promise<T> {
        const prior = this.writes;
        let release!: () => void;
        this.writes = new Promise<void>((resolve) => {
            release = resolve;
        });
        await prior;
        try {
            return await operation();
        } finally {
            release();
        }
    }

    private async readRecords(): Promise<LocalProjectRecord[]> {
        try {
            const parsed: unknown = JSON.parse(await readFile(this.registryPath, 'utf8'));
            if (!Array.isArray(parsed)) {
                throw new Error('Local project registry is invalid');
            }
            return parsed.filter(this.isRecord);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    private async writeRecords(records: LocalProjectRecord[]): Promise<void> {
        const temporaryPath = `${this.registryPath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, JSON.stringify(records, null, 2));
        await rename(temporaryPath, this.registryPath);
    }

    private isRecord = (value: unknown): value is LocalProjectRecord => {
        if (!value || typeof value !== 'object') {
            return false;
        }
        const record = value as Partial<LocalProjectRecord>;
        return (
            typeof record.id === 'string' &&
            PROJECT_ID.test(record.id) &&
            typeof record.ownerId === 'string' &&
            typeof record.title === 'string' &&
            typeof record.createdAt === 'string'
        );
    };

    private toProject(record: LocalProjectRecord): LocalProject {
        return {
            ...record,
            directory: path.join(this.projectDirectories, record.id),
        };
    }
}
