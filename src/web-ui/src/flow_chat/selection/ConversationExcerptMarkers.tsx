import { useLayoutEffect, useState } from 'react';
import type { ConversationExcerptContext } from '@/shared/types/context';
import { excerptNumber } from '@/shared/utils/conversationExcerpt';
import { findExcerptSource, resolveExcerptRange } from './flowChatSelection';
import { useConversationExcerptSources } from './conversationExcerptSourceContext';
import { ConversationExcerptPreview } from './ConversationExcerptAttachments';
import { measureExcerptMarkerPosition } from './conversationExcerptMarkerPosition';

interface MarkerGroup {
  key: string;
  element: HTMLElement;
  left: number;
  top: number;
  excerpts: readonly ConversationExcerptContext[];
}

/** Row-local overlays: annotation marks never modify transcript text or row height. */
export function ConversationExcerptMarkers({ wrapper, turnId }: { wrapper: HTMLElement | null; turnId: string }) {
  const excerpts = useConversationExcerptSources(turnId);
  const [groups, setGroups] = useState<MarkerGroup[]>([]);
  useLayoutEffect(() => {
    if (!wrapper || !excerpts.length) { setGroups(previous => previous.length ? [] : previous); return; }
    const view = wrapper.ownerDocument.defaultView;
    if (!view) return;
    let frame: number | null = null;
    const refresh = () => {
      frame = null;
      const next = new Map<string, MarkerGroup>();
      for (const excerpt of excerpts) {
        if (!excerptNumber(excerpt)) continue;
        for (const fragment of excerpt.fragments) {
          if (fragment.turnId !== turnId) continue;
          const element = findExcerptSource(wrapper, fragment);
          const range = element && resolveExcerptRange(element, fragment);
          const position = element && range && measureExcerptMarkerPosition(wrapper, element, range);
          if (!element || !position) continue;
          // Separate selections in one text block keep their own superscripts.
          const key = JSON.stringify([fragment.flowItemId ?? null, fragment.end]);
          const previous = next.get(key);
          if (previous) {
            if (!previous.excerpts.some(item => item.id === excerpt.id)) previous.excerpts = [...previous.excerpts, excerpt];
          } else next.set(key, {
            key, element, ...position, excerpts: [excerpt],
          });
        }
      }
      const values = [...next.values()];
      setGroups(previous => previous.length === values.length && previous.every((group, i) => {
        const other = values[i];
        return group.key === other.key && group.element === other.element && group.left === other.left && group.top === other.top
          && group.excerpts.length === other.excerpts.length && group.excerpts.every((excerpt, j) => excerpt === other.excerpts[j]);
      }) ? previous : values);
    };
    const schedule = () => { if (frame === null) frame = view.requestAnimationFrame(refresh); };
    const mutation = new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return !target?.closest('[data-openbitfun-product-part="markers"]');
      })) schedule();
    });
    mutation.observe(wrapper, { childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open', 'data-expanded'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(wrapper);
    wrapper.addEventListener('scroll', schedule, { capture: true, passive: true });
    wrapper.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
    refresh();
    return () => {
      if (frame !== null) view.cancelAnimationFrame(frame);
      mutation.disconnect(); resize.disconnect();
      wrapper.removeEventListener('scroll', schedule, true);
      wrapper.ownerDocument.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [wrapper, excerpts, turnId]);

  return <>{groups.map(group => (
    <sup key={group.key}
      data-openbitfun-product-component="conversation-excerpt" data-openbitfun-product-part="markers"
      className="conversation-excerpt__markers" data-flowchat-selection-ignore="true"
      style={{ left: `max(var(--openbitfun-space-5), ${group.left}px)`, top: group.top }}>
      {group.excerpts.map(excerpt => <ConversationExcerptPreview key={excerpt.id} excerpt={excerpt} superscript origin="source" />)}
    </sup>
  ))}</>;
}
