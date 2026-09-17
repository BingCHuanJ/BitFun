import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function extractBlock(source: string, selector: string): string {
  const selectorStart = source.indexOf(selector);
  expect(selectorStart, `Missing selector: ${selector}`).toBeGreaterThanOrEqual(0);

  const blockStart = source.indexOf('{', selectorStart);
  expect(blockStart, `Missing block for selector: ${selector}`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(blockStart + 1, index);
    }
  }

  throw new Error(`Unclosed block for selector: ${selector}`);
}

describe('UserMessageItem metadata visibility', () => {
  it('shows the copy, edit, and rollback actions as one always-available cluster', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./UserMessageItem.scss', import.meta.url)),
      'utf8',
    ).replace(/\r\n?/g, '\n');
    const actions = extractBlock(stylesheet, '\n.user-message-item__actions {');
    const shell = extractBlock(stylesheet, '.user-message-item-shell {');

    expect(actions).toContain('opacity: 1;');
    expect(actions).toContain('pointer-events: auto;');
    expect(shell).not.toContain('.user-message-item__actions');

    expect(stylesheet).toContain([
      '.user-message-item__copy-btn,',
      '.user-message-item__edit-btn,',
      '.user-message-item__rollback-btn {',
    ].join('\n'));
    expect(stylesheet).not.toContain('.user-message-item__edit-btn {\n  opacity: 1;');
  });

  it('keeps visible metadata in normal flow on the transcript reading column', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./UserMessageItem.scss', import.meta.url)),
      'utf8',
    ).replace(/\r\n?/g, '\n');
    const shell = extractBlock(stylesheet, '.user-message-item-shell {');
    const timestamp = extractBlock(stylesheet, '\n.user-message-item__timestamp {');
    const sharedLayout = readFileSync(
      fileURLToPath(new URL('../../_transcript-layout.scss', import.meta.url)),
      'utf8',
    );
    const metaLayout = extractBlock(sharedLayout, '@mixin metadata-row {');

    expect(timestamp).toContain('opacity: 1;');
    expect(timestamp).toContain('pointer-events: none;');
    expect(timestamp).toContain('margin-inline-end: auto;');
    const meta = extractBlock(stylesheet, '\n.user-message-item__meta {');
    expect(metaLayout).toContain('display: flex;');
    expect(meta + metaLayout).not.toMatch(/position:\s*(absolute|fixed);/);
    expect(meta + metaLayout).not.toMatch(/(?:^|\n)\s*(?:max-)?height:/);
    expect(metaLayout).toContain('justify-content: flex-end;');
    const bubble = extractBlock(stylesheet, '\n.user-message-item {');
    expect(bubble).toContain('padding: 0.46rem var(--_user-message-padding-inline);');
    expect(shell).toContain('--_user-message-padding-inline: max(0px, calc(var(--_user-message-radius) - var(--_user-message-border-width)));');
    expect(bubble).toContain('margin-inline: calc(-1 * var(--_user-message-radius));');
    expect(meta).toContain('padding-inline: 0;');
    expect(meta).toContain('padding-block: calc(var(--openbitfun-space-1) / 2) 0;');
    expect(meta).toContain('pointer-events: auto;');
    expect(shell).not.toContain('.user-message-item__timestamp');
    expect(shell).not.toContain('&--with-timestamp');
  });
});
