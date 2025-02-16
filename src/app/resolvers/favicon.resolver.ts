import { DOCUMENT, isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { FAVICON_URL } from '../tokens/favicon-url.token';

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
  faviconLinkElement.href = 'assets/' + faviconUrl;
};
