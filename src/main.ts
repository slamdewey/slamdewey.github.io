import { enableProdMode, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { env } from './environments/environment';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { NGX_MONACO_EDITOR_CONFIG } from 'ngx-monaco-editor-v2';
import { FAVICON_URL } from './app/tokens/favicon-url.token';
import { monacoConfig } from './app/util/monaco-config';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';

if ('prod' === env.enviornment) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withFetch()),
    provideRouter(routes),
    {
      provide: NGX_MONACO_EDITOR_CONFIG,
      useValue: monacoConfig,
    },
    {
      provide: FAVICON_URL,
      useValue: 'home-favicon.ico',
    },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: {
        subscriptSizing: 'dynamic',
      },
    },
    provideExperimentalZonelessChangeDetection(),
    provideAnimationsAsync(),
  ],
});
