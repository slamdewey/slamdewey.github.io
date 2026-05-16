import { DOCUMENT, isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { FAVICON_URL } from '../tokens/favicon-url.token';

let faviconIntervalId: ReturnType<typeof setInterval> | null = null;
const faviconDataUriCache = new Map<string, string>();

async function resolveDataUri(url: string): Promise<string> {
  const cached = faviconDataUriCache.get(url);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch('assets/' + url);
    if (!response.ok) {
      return 'assets/' + url;
    }
    const svgText = await response.text();
    const dataUri = 'data:image/svg+xml;base64,' + btoa(svgText);
    faviconDataUriCache.set(url, dataUri);
    return dataUri;
  } catch {
    return 'assets/' + url;
  }
}

function applyFavicon(link: HTMLLinkElement, href: string): void {
  link.href = href;
  if (href.startsWith('data:')) {
    link.type = 'image/svg+xml';
  } else {
    link.type = href.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon';
  }
}

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * @description This resolver is used to set the favicon of the page based on the route.
 * Supports a single favicon string or an array of strings to randomly cycle through.
 */
export const faviconResolverFn: ResolveFn<void> = async () => {
  const platformId = inject(PLATFORM_ID);

  if (isPlatformServer(platformId)) {
    return;
  }

  const document = inject(DOCUMENT);
  const faviconUrl = inject(FAVICON_URL);

  /**
   * this element is defined in the index.html
   */
  const faviconLinkElement = document.getElementById('faviconLink') as HTMLLinkElement;

  if (faviconIntervalId !== null) {
    clearInterval(faviconIntervalId);
    faviconIntervalId = null;
  }

  if (Array.isArray(faviconUrl)) {
    const resolvedUris = await Promise.all(faviconUrl.map((url) => resolveDataUri(url)));

    let queue = shuffle(resolvedUris);
    let index = 0;
    applyFavicon(faviconLinkElement, queue[0]);
    faviconIntervalId = setInterval(() => {
      index++;
      if (index >= queue.length) {
        queue = shuffle(resolvedUris);
        index = 0;
      }
      applyFavicon(faviconLinkElement, queue[index]);
    }, 2000);
  } else {
    const resolvedUri = await resolveDataUri(faviconUrl);
    applyFavicon(faviconLinkElement, resolvedUri);
  }
};
