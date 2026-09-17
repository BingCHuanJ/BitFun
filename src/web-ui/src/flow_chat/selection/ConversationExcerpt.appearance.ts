import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance';

export const conversationExcerptAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'conversation-excerpt',
  componentAttribute: 'data-openbitfun-product-component',
  parts: [
    { id: 'root' }, { id: 'toolbar' }, { id: 'editor' }, { id: 'attachments' },
    { id: 'attachment' }, { id: 'dialog' }, { id: 'quote' }, { id: 'quoteText' },
    { id: 'comment' }, { id: 'locate' }, { id: 'preview' }, { id: 'markers' }, { id: 'superscript' },
  ],
  states: [],
};
