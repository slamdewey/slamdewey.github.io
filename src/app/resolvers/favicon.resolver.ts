import { DOCUMENT, isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { FAVICON_URL } from '../tokens/favicon-url.token';

let faviconIntervalId: ReturnType<typeof setInterval> | null = null;

function applyFavicon(link: HTMLLinkElement, url: string): void {
  link.href = 'assets/' + url;
  link.type = url.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon';
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
export const faviconResolverFn: ResolveFn<void> = () => {
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
    let queue = shuffle(faviconUrl);
    let index = 0;
    applyFavicon(faviconLinkElement, queue[0]);
    faviconIntervalId = setInterval(() => {
      index++;
      if (index >= queue.length) {
        queue = shuffle(faviconUrl);
        index = 0;
      }
      applyFavicon(faviconLinkElement, queue[index]);
    }, 2000);
  } else {
    applyFavicon(faviconLinkElement, faviconUrl);
  }
};
