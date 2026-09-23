import type { Frame } from '@onlook/models';

export type DrivenFrameReference = {
    url: string;
    pageId: string;
    variantId?: string | null;
};

export function applyDrivenFrameReference(
    frame: Frame,
    reference: DrivenFrameReference,
): Frame {
    return {
        ...frame,
        url: reference.url,
        drivenPageId: reference.pageId,
        drivenVariantId: reference.variantId ?? null,
    };
}
