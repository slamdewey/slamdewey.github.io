import { Route } from '@angular/router';
import { GalleryComponent } from './gallery/gallery.component';
import { HomeComponent } from './home/home.component';
import { ProjectsComponent } from './projects/projects.component';
import { FragmentWriterComponent } from './projects/pages/fragment-writer/fragment-writer.component';
import { UnitTaskingComponent } from './projects/pages/unit-tasking/unit-tasking.component';
import { FAVICON_URL } from './tokens/favicon-url.token';
import { faviconResolverFn } from './resolvers/favicon.resolver';
import { ShootingGameComponent } from './projects/pages/shooting-game/shooting-game.component';

export const routes: Route[] = [
  {
    path: '',
    component: HomeComponent,
    providers: [
      {
        provide: FAVICON_URL,
        useValue: 'home-favicon.ico',
      },
    ],
    resolve: [faviconResolverFn],
  },
  {
    path: 'gallery',
    component: GalleryComponent,
    providers: [
      {
        provide: FAVICON_URL,
        useValue: 'photo-favicon.ico',
      },
    ],
    resolve: [faviconResolverFn],
  },
  {
    path: 'projects',
    component: ProjectsComponent,
    providers: [
      {
        provide: FAVICON_URL,
        useValue: 'project-favicon.ico',
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
        component: FragmentWriterComponent,
      },
      {
        path: 'unit-tasking',
        title: 'An experimental page',
        component: UnitTaskingComponent,
      },
      {
        path: 'shooting-game',
        title: 'An experimental game',
        component: ShootingGameComponent,
      },
    ],
    providers: [
      {
        provide: FAVICON_URL,
        useValue: 'project-favicon.ico',
      },
    ],
    resolve: [faviconResolverFn],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
