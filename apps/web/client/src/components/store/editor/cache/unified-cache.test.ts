import { describe, expect, it } from 'bun:test';
import { UnifiedCacheManager } from './unified-cache';

/**
 * O cache do editor, sem `window`.
 *
 * No servidor não existe IndexedDB, e o cache persistente é do navegador. O que se verifica aqui é
 * que um cache declarado **não persistente** funciona inteiro na memória e não toca no
 * armazenamento local — é a condição que o runtime local precisa para servir o projeto sem abrir
 * um banco do navegador que não existe.
 *
 * O valor guardado é um objeto porque o tipo do cache pede uma forma indexável (`Serializable`),
 * e é essa forma que o editor guarda na prática.
 */
type CachedValue = { value: string };

describe('UnifiedCacheManager on the server', () => {
    it('keeps a non-persistent memory cache without loading IndexedDB', () => {
        const cache = new UnifiedCacheManager<CachedValue>({ name: 'server', maxItems: 2, maxSizeBytes: 1024, persistent: false, ttlMs: 1000 });
        cache.set('one', { value: 'value' });
        expect(cache.get('one')).toEqual({ value: 'value' });
    });
});
