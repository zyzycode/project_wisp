import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatInput } from '../../src/renderer/components/Chat/ChatInput';
import { PET_PRESENTATION_LAYOUT } from '../../src/shared/pet-presentation-layout';

const css = readFileSync(resolve('src/renderer/index.css'), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
}

describe('chat layout', () => {
  it('centers the status label without a canvas-bottom margin or hover shift', () => {
    expect(rule('.pet-label')).toMatch(/position:\s*absolute/);
    expect(rule('.pet-label')).toMatch(/transform:\s*translateX\(-50%\)/);
    expect(rule('.pet-label')).not.toMatch(/margin-top:/);
    expect(rule('.pet-label:hover')).toMatch(/transform:\s*translateX\(-50%\) scale\(1.04\)/);
  });
  it('anchors the composer independently of reply height and presence', () => {
    const markup = renderToStaticMarkup(<ChatInput isOpen canSubmit onSendMessage={vi.fn()} onClose={vi.fn()} />);
    const className = markup.match(/class="([^"]+)"/)?.[1];
    const styles = rule(`.${className}`);
    expect(styles).toMatch(/position:\s*relative/);
    expect(rule('.chat-overlay')).toMatch(/top:\s*calc\(var\(--character-top\) - 104px\)/);
    expect(rule('.speech-bubble')).toMatch(/position:\s*absolute/);
    expect(rule('.speech-bubble')).toMatch(/bottom:\s*calc\(100% \+ 2px\)/);
    expect(styles).not.toMatch(/\btop:/);
    expect(rule('.chat-input-field')).toMatch(/min-width:\s*0/);
  });

  it('bounds long replies and notices within the shared column', () => {
    expect(rule('.speech-bubble')).toMatch(/max-height:\s*calc\(var\(--character-top\) - 112px\)/);
    expect(rule('.speech-content')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.wisp-chat-input-container')).toMatch(/max-height:\s*96px/);
    expect(rule('.wisp-chat-input-container')).toMatch(/overflow-y:\s*auto/);
  });

  it('reserves room above the character for reply, composer notices, and gaps', () => {
    const characterTop = PET_PRESENTATION_LAYOUT.characterRect.y;
    const composerTop = characterTop - 104;
    const replyHeight = characterTop - 112;
    expect(replyHeight).toBeGreaterThanOrEqual(128);
    expect(composerTop - 2 - replyHeight).toBeGreaterThanOrEqual(6);
    expect(composerTop + 96).toBeLessThanOrEqual(characterTop - 8);
    const { characterRect, compactWindowSize } = PET_PRESENTATION_LAYOUT;
    expect(compactWindowSize.height - characterRect.y - characterRect.height).toBe(62);
  });
});

