export interface ImagesJson {
  directories: string[];
  img: Record<string, GalleryImageData[]>;
}

export interface GalleryImageData {
  title: string;
  caption: string;
  img_src: string;
  placeholder_src: string;
  lastModified: string;
}

export interface GalleryDirectory {
  path: string;
  label: string;
}

export interface GalleryRouteQueryParams {
  folder: string;
}
