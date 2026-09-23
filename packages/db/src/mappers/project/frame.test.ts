import { describe, expect, it } from 'bun:test';
import { fromDbFrame, toDbFrame } from './frame';

describe('frame Driven persistence mapping', () => {
    it('keeps the Driven page and variant across a database round-trip', () => {
        const frame = {
            id: '5b8f8c8e-2e7a-4a49-9ea4-0a1f005d0f2a',
            canvasId: '7b8f8c8e-2e7a-4a49-9ea4-0a1f005d0f2a',
            branchId: '8b8f8c8e-2e7a-4a49-9ea4-0a1f005d0f2a',
            url: 'http://127.0.0.1:3200/p/home/home--a?live=1',
            drivenPageId: 'home',
            drivenVariantId: 'home--a',
            position: { x: 12, y: 24 },
            dimension: { width: 1280, height: 720 },
        } as const;

        const persisted = toDbFrame(frame);
        const reopened = fromDbFrame(persisted);

        expect(reopened.drivenPageId).toBe('home');
        expect(reopened.drivenVariantId).toBe('home--a');
    });
});
