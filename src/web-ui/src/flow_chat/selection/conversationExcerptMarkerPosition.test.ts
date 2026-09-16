import { describe, expect, it } from 'vitest';
import { computeExcerptMarkerPosition } from './conversationExcerptMarkerPosition';

const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});
const wrapper = rect(100, 200, 600, 300);
const source = rect(100, 210, 600, 100);

describe('annotation text endpoint coordinates', () => {
  it('positions the mark at the caret instead of the source corner', () => {
    expect(computeExcerptMarkerPosition(wrapper, rect(246, 214, 0, 18), source)).toEqual({ left: 146, top: 14 });
    expect(computeExcerptMarkerPosition(wrapper, rect(412, 214, 0, 18), source)).toEqual({ left: 312, top: 14 });
  });

  it('follows the endpoint onto its new line after wrapping', () => {
    expect(computeExcerptMarkerPosition(wrapper, rect(162, 244, 0, 18), source)).toEqual({ left: 62, top: 44 });
  });

  it('omits an endpoint outside a nested clip rather than moving it to other visible text', () => {
    const clip = rect(100, 210, 250, 24);
    expect(computeExcerptMarkerPosition(wrapper, rect(246, 244, 0, 18), clip)).toBeNull();
    expect(computeExcerptMarkerPosition(wrapper, rect(380, 214, 0, 18), clip)).toBeNull();
    expect(computeExcerptMarkerPosition(wrapper, rect(246, 214, 0, 0), source)).toBeNull();
  });
});
