import { Route } from '@angular/router';
import { FAVICON_URL } from './tokens/favicon-url.token';
import { faviconResolverFn } from './resolvers/favicon.resolver';

export const routes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent),
    providers: [
      {
        provide: FAVICON_URL,
        useValue: [
          'callme.svg',
          'clown.svg',
          'disguise.svg',
          'explosion.svg',
          'fear.svg',
          'grinning_face_with_sweat.svg',
          'halo.svg',
          'laughing_tears.svg',
          'laughing_tears_rolling.svg',
          'melting.svg',
          'prosper.svg',
          'saluting.svg',
          'smiling_with_tear.svg',
          'starstruck.svg',
          'thinking.svg',
          'upsidedown.svg',
        ],
      },
    ],
    resolve: [faviconResolverFn],
  },
  {
    path: 'gallery',
    loadComponent: () => import('./gallery/gallery.component').then((m) => m.GalleryComponent),
    providers: [
      {
        provide: FAVICON_URL,
        useValue: 'photo-favicon.svg',
      },
    ],
    resolve: [faviconResolverFn],
  },
  {
    path: 'projects',
    loadComponent: () => import('./projects/projects.component').then((m) => m.ProjectsComponent),
    providers: [
      {
        provide: FAVICON_URL,
        useValue: 'project-favicon.svg',
      },
    ],
    resolve: [faviconResolverFn],
  },
  {
    path: 'projects',
    children: [
      {
        path: 'fragment-writer',
        title: 'Web based GLSL Fragment Shader Editor',
        loadComponent: () =>
          import('./projects/pages/fragment-writer/fragment-writer.component').then((m) => m.FragmentWriterComponent),
      },
      {
        path: 'unit-tasking',
        title: 'An experimental page',
        loadComponent: () =>
          import('./projects/pages/unit-tasking/unit-tasking.component').then((m) => m.UnitTaskingComponent),
      },
      {
        path: 'shooting-game',
        title: 'An experimental game',
        loadComponent: () =>
          import('./projects/pages/shooting-game/shooting-game.component').then((m) => m.ShootingGameComponent),
      },
      {
        path: 'world-gen',
        title: 'Procedural World Generation',
        loadComponent: () => import('./projects/pages/world-gen/world-gen.component').then((m) => m.WorldGenComponent),
      },
      {
        path: 'voronoi-demo',
        title: 'Voronoi Tessellation',
        loadComponent: () =>
          import('./projects/pages/voronoi-demo/voronoi-demo.component').then((m) => m.VoronoiDemoComponent),
      },
    ],
    providers: [
      {
        provide: FAVICON_URL,
        useValue: 'project-favicon.svg',
      },
    ],
    resolve: [faviconResolverFn],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
