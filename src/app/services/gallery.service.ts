import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { env } from 'src/environments/environment';
import { DropdownItemData } from '../lib/dropdown';
import { ImagesJson, GalleryImageData } from '../lib/gallery';

const IMAGES_JSON_URL = env.imageCdnUrl + 'images.json';

@Injectable({
  providedIn: 'root',
})
export class GalleryService {
  private readonly http = inject(HttpClient);

  public imagesJson = signal<ImagesJson>({ directories: [], img: {} });
  public loaded = signal<boolean>(false);

  constructor() {
    this.http.get<ImagesJson>(IMAGES_JSON_URL).subscribe((data) => {
      this.imagesJson.set(data);
      this.loaded.set(true);
    });
  }

  public galleryFolderDropownItems = computed<DropdownItemData[]>(() => {
    return this.imagesJson().directories.map((folder) => ({
      key: folder,
      label: this.getFormattedLabelFromPath(folder),
      url: '/gallery',
      queryParams: { folder },
    }));
  });

  public galleryImageDataByFolder = computed<Map<string, GalleryImageData[]>>(() => {
    const imageTileData = new Map<string, GalleryImageData[]>();
    const imageSet = this.imagesJson().img;

    this.imagesJson().directories.forEach((directoryPath) => {
      const imagesForThisDirectory = imageSet[directoryPath].map((image: GalleryImageData) => {
        return {
          ...image,
          placeholder_src: env.imageCdnUrl + image.placeholder_src,
          img_src: env.imageCdnUrl + image.img_src,
        } as GalleryImageData;
      });
      imageTileData.set(directoryPath, imagesForThisDirectory);
    });
    return imageTileData;
  });

  private getFormattedLabelFromPath(directoryPath: string): string {
    const noSpecialChar = directoryPath.replace(/[^a-zA-Z0-9]/g, ' ');
    if (noSpecialChar.length < 1) {
      return noSpecialChar;
    }
    return noSpecialChar.charAt(0).toUpperCase() + noSpecialChar.slice(1);
  }
}
