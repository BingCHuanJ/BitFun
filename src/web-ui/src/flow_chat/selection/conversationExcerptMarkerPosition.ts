type Rect = Pick<DOMRectReadOnly, 'top' | 'bottom' | 'left' | 'right' | 'width' | 'height'>;

export interface ExcerptMarkerPosition { left: number; top: number }

/** A superscript follows the selection's trailing caret, including a wrapped line. */
export function computeExcerptMarkerPosition(wrapper: Rect, caret: Rect, visible: Rect): ExcerptMarkerPosition | null {
  if (caret.height <= 0 || caret.top < visible.top || caret.bottom > visible.bottom
    || caret.right < visible.left || caret.left > visible.right) return null;
  return { left: Math.max(0, Math.min(wrapper.width, caret.right - wrapper.left)), top: caret.top - wrapper.top };
}

export function measureExcerptMarkerPosition(wrapper: HTMLElement, source: HTMLElement, range: Range): ExcerptMarkerPosition | null {
  const view = wrapper.ownerDocument.defaultView;
  if (!view) return null;
  // A collapsed range follows the logical text endpoint through inline markup
  // and bidi text; a block rectangle or the first visible line cannot do that.
  const endpoint = range.cloneRange();
  endpoint.collapse(false);
  const caret = [...endpoint.getClientRects()].find(rect => rect.height > 0);
  if (!caret) return null;
  const sourceRect = source.getBoundingClientRect();
  const bounds = wrapper.getBoundingClientRect();
  const visible = {
    top: Math.max(sourceRect.top, bounds.top), bottom: Math.min(sourceRect.bottom, bounds.bottom),
    left: Math.max(sourceRect.left, bounds.left), right: Math.min(sourceRect.right, bounds.right),
    width: sourceRect.width, height: sourceRect.height,
  };
  for (let element = endpoint.endContainer.parentElement; element && element !== wrapper; element = element.parentElement) {
    const style = view.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return null;
    const rect = element.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      visible.top = Math.max(visible.top, rect.top); visible.bottom = Math.min(visible.bottom, rect.bottom);
    }
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
      visible.left = Math.max(visible.left, rect.left); visible.right = Math.min(visible.right, rect.right);
    }
  }
  return computeExcerptMarkerPosition(bounds, caret, visible);
}
