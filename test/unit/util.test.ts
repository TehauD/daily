import { describe, expect, it } from 'vitest';
import { escapeHtml, hash, normalizeText } from '../../src/core/util';
import { isHostedDemo } from '../../src/core/demo';

describe('util', () => {
  it('hashes deterministically', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });
  it('normalizes text for comparison', () => {
    expect(normalizeText('a  \r\nb\t\n\n')).toBe('a\nb');
  });
  it('escapes HTML', () => {
    expect(escapeHtml('<a href="x">\'&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
  it('detects the hosted demo', () => {
    const at = (href: string) => isHostedDemo(new URL(href) as unknown as Location);
    expect(at('https://thedaily.azurewebsites.net/')).toBe(true);
    expect(at('http://127.0.0.1:8000/')).toBe(false);
    expect(at('http://localhost:3000/')).toBe(false);
    expect(at('file:///home/me/index.html')).toBe(false);
  });
});
