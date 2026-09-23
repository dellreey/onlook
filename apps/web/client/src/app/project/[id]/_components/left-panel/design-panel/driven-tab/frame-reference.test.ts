import { describe, expect, it } from 'bun:test';
import type { Frame } from '@onlook/models';
import { applyDrivenFrameReference } from './frame-reference';

const frame: Frame = {
    id: 'frame-1',
    branchId: 'branch-1',
    canvasId: 'canvas-1',
    position: { x: 0, y: 0 },
    dimension: { width: 100, height: 100 },
    url: 'http://old.example.test',
    drivenPageId: 'old-page',
    drivenVariantId: 'old-variant',
};

describe('Driven frame reference application', () => {
    it('applies the router canonical reference in memory without persistence', () => {
        const result = applyDrivenFrameReference(frame, {
            url: 'http://preview.example.test/p/canonical-page/canonical-variant?live=1',
            pageId: 'canonical-page',
            variantId: 'canonical-variant',
        });

        expect(result).toEqual({
            ...frame,
            url: 'http://preview.example.test/p/canonical-page/canonical-variant?live=1',
            drivenPageId: 'canonical-page',
            drivenVariantId: 'canonical-variant',
        });
        expect(frame.drivenPageId).toBe('old-page');
        expect(frame.drivenVariantId).toBe('old-variant');
    });
});
