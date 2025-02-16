import { computed, Injectable, signal } from '@angular/core';
import { env } from 'src/environments/environment';
import { DropdownItemData } from '../shapes/dropdown';
import { ImagesJson, GalleryImageData } from '../shapes/gallery';

import * as imagesJsonModule from '../../../images.json';
const IMAGES_JSON = (imagesJsonModule as any).default as ImagesJson;

@Injectable({
  providedIn: 'root',
})
export class GalleryService {
  public imagesJson = signal<ImagesJson>(IMAGES_JSON);

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
