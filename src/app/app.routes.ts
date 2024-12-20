import { Route } from '@angular/router';
import { GalleryComponent } from './gallery/gallery.component';
import { HomeComponent } from './home/home.component';
import { ProjectsComponent } from './projects/projects.component';
import { FragmentWriterComponent } from './projects/pages/fragment-writer/fragment-writer.component';
import { UnitTaskingComponent } from './projects/pages/unittasking/unittasking.component';

export type FaviconStorage = {
  faviconPath: string;
};

export const routes: (Route & FaviconStorage)[] = [
  {
    path: '',
    component: HomeComponent,
    faviconPath: 'home-favicon.ico',
  },
  {
    path: 'gallery',
    component: GalleryComponent,
    faviconPath: 'photo-favicon.ico',
  },
  {
    path: 'projects',
    component: ProjectsComponent,
    faviconPath: 'project-favicon.ico',
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
    ],
    faviconPath: 'projects-favicon.ico',
  },
  {
    path: '**',
    pathMatch: 'full',
    component: HomeComponent,
    faviconPath: '',
  },
];
