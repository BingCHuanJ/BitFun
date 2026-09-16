import { useState } from 'react';
import { Button } from '@openbitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import type { ContextItem, ConversationExcerptContext } from '@/shared/types/context';
import { excerptNumber, isConversationExcerpt } from '@/shared/utils/conversationExcerpt';
import { ChatInputAttachment } from '../components/ChatInputAttachment';
import { ConversationExcerptDialog } from './ConversationExcerptDialog';
import { conversationExcerptDialogTarget, type ExcerptDialogTarget } from './conversationExcerptEditing';
import './ConversationExcerpt.scss';

interface ExcerptDialogState {
  target: ExcerptDialogTarget;
  open: boolean;
}

function useExcerptLabel(excerpt: ConversationExcerptContext) {
  const { t, formatNumber } = useI18n('flow-chat');
  const number = excerptNumber(excerpt);
  return {
    label: number ? t('selection.numbered', { number: formatNumber(number) }) : t('selection.annotation'),
    mark: number ? `#${formatNumber(number)}` : t('selection.annotation'),
    numberLabel: number ? formatNumber(number) : undefined,
  };
}

function ExcerptAttachment({ excerpt, onUpdate, onRemove }: {
  excerpt: ConversationExcerptContext;
  onUpdate: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n('flow-chat');
  const { label, mark } = useExcerptLabel(excerpt);
  const [dialog, setDialog] = useState<ExcerptDialogState | null>(null);
  const openDialog = () => {
    const scope = getActiveSurfaceScope();
    // The owning composer supplies the write, including a sent-message edit draft.
    setDialog({ open: true, target: {
      mode: 'edit', excerpt,
      isCurrent: () => scope.isCurrent() && scope.surfaceId === excerpt.source.surfaceId,
      save: comment => {
        if (!scope.isCurrent() || scope.surfaceId !== excerpt.source.surfaceId) return 'unavailable';
        onUpdate(excerpt.id, comment.trim());
        return 'saved';
      },
    } });
  };
  return <>
    <ChatInputAttachment kind="annotation" label={excerpt.comment ? `${label}: ${excerpt.comment}` : label}
      removeLabel={t('selection.removeNumbered', { annotation: label })} onRemove={() => onRemove(excerpt.id)}>
      <Button variant="text" size="sm" className="conversation-excerpt__attachment"
        data-openbitfun-product-component="conversation-excerpt" data-openbitfun-product-part="attachment"
        aria-label={label} aria-haspopup="dialog" onClick={openDialog}>
        {mark}
      </Button>
    </ChatInputAttachment>
    {dialog && <ConversationExcerptDialog target={dialog.target} label={label} open={dialog.open}
      onOpenChange={open => setDialog(current => current && { ...current, open })} />}
  </>;
}

export function ConversationExcerptAttachments({ contexts, onUpdate, onRemove, inline = false }: {
  contexts: ContextItem[];
  onUpdate: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  inline?: boolean;
}) {
  const excerpts = contexts.filter(isConversationExcerpt);
  if (!excerpts.length) return null;
  return <div data-openbitfun-product-component="conversation-excerpt" data-openbitfun-product-part="attachments"
    className={`conversation-excerpt__attachments${inline ? ' conversation-excerpt__attachments--inline' : ''}`}
    data-flowchat-selection-ignore="true">
    {excerpts.map(excerpt => <ExcerptAttachment key={excerpt.id} excerpt={excerpt} onUpdate={onUpdate} onRemove={onRemove} />)}
  </div>;
}

export function ConversationExcerptPreview({ excerpt, superscript = false, origin = 'sent' }: {
  excerpt: ConversationExcerptContext;
  superscript?: boolean;
  origin?: 'source' | 'sent';
}) {
  const { label, numberLabel } = useExcerptLabel(excerpt);
  const [dialog, setDialog] = useState<ExcerptDialogState | null>(null);
  const openDialog = () => setDialog({ open: true, target: conversationExcerptDialogTarget(excerpt, origin) });
  return <span data-openbitfun-product-component="conversation-excerpt" data-openbitfun-product-part="preview"
    className="conversation-excerpt__preview" data-flowchat-selection-ignore="true" onClick={event => event.stopPropagation()}>
    {superscript ? <Button size="xs" variant="primary" labelBehavior="static" className="conversation-excerpt__superscript"
      data-openbitfun-product-component="conversation-excerpt" data-openbitfun-product-part="superscript"
      aria-label={label} title={excerpt.comment || label} onClick={openDialog} aria-haspopup="dialog">{numberLabel ?? label}</Button>
      : <Button size="xs" variant="text" aria-label={label} title={excerpt.comment || label}
        onClick={openDialog} aria-haspopup="dialog">{label}</Button>}
    {dialog && <ConversationExcerptDialog target={dialog.target} label={label} open={dialog.open}
      onOpenChange={open => setDialog(current => current && { ...current, open })} />}
  </span>;
}
