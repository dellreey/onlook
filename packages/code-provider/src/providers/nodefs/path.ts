import { realpath } from 'node:fs/promises';
import path from 'node:path';

function outsideProjectRoot(): Error {
    return new Error('Path is outside project root');
}

function isInside(projectRoot: string, candidate: string): boolean {
    const relative = path.relative(projectRoot, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function nearestExistingParent(candidate: string, projectRoot: string): Promise<string> {
    let current = candidate;
    while (true) {
        try {
            return await realpath(current);
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
                throw error;
            }

            const parent = path.dirname(current);
            if (parent === current || !isInside(projectRoot, parent)) {
                throw outsideProjectRoot();
            }
            current = parent;
        }
    }
}

/**
 * Resolves an untrusted relative project path to a path whose existing target
 * (or nearest existing parent for a write) is canonically contained by the
 * project root. This catches traversal and symlinks escaping the project.
 */
export async function resolveProjectPath(projectRoot: string, requestedPath: string): Promise<string> {
    const canonicalRoot = await realpath(projectRoot);
    if (path.isAbsolute(requestedPath)) {
        throw outsideProjectRoot();
    }

    const candidate = path.resolve(canonicalRoot, requestedPath);
    if (!isInside(canonicalRoot, candidate)) {
        throw outsideProjectRoot();
    }

    try {
        const canonicalTarget = await realpath(candidate);
        if (!isInside(canonicalRoot, canonicalTarget)) {
            throw outsideProjectRoot();
        }
        return canonicalTarget;
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
        }
    }

    const existingParent = await nearestExistingParent(path.dirname(candidate), canonicalRoot);
    if (!isInside(canonicalRoot, existingParent)) {
        throw outsideProjectRoot();
    }
    return candidate;
}
