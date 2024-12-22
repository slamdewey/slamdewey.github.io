import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { Backdrop } from '../components/backdrop/backdrop';
import { ImageTileComponent, ImageTileData } from '../components/image-tile/image-tile.component';
import { ImageViewerModalComponent } from '../components/image-viewer-modal/image-viewer-modal.component';
import { DropdownLinkSelectorComponent } from '../components/dropdown-link-selector/dropdown-link-selector.component';
import { WalkingNoiseBackdrop } from '../components/backdrop/WalkingNosieBackdrop';
import { GalleryImageData, GalleryRouteQueryParams, ImagesJson } from '../shapes/gallery';
import { env } from '../../environments/environment';
import { BackdropComponent } from '../components/backdrop/backdrop.component';
import { BannerComponent } from '../components/banner/banner.component';
import * as imagesJsonModule from '../../../images.json';
import { DropdownItemData } from '../shapes/dropdown';

const IMAGES_JSON = (imagesJsonModule as any).default as ImagesJson;

@Component({
    selector: 'x-gallery',
    templateUrl: './gallery.component.html',
    styleUrls: ['./gallery.component.scss'],
    imports: [
        BackdropComponent,
        BannerComponent,
        DropdownLinkSelectorComponent,
        ImageTileComponent,
        ImageViewerModalComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class GalleryComponent implements OnInit {
  @ViewChild('imageViewerModal') imageViewerModal: ImageViewerModalComponent;

  public bgAnimation: Backdrop = new WalkingNoiseBackdrop();

  // imagesJson was once async loaded, and may return that way again.
  public imagesJson = signal<ImagesJson>(IMAGES_JSON);

  public imageFolderLinks = computed<DropdownItemData[]>(() => {
    return this.imagesJson().directories.map((folder) => ({
      text: this.formatFolderName(folder),
      url: '/gallery',
      queryParams: { folder },
    }));
  });
  public imageTileDataSet = computed<Map<string, ImageTileData[]>>(() => {
    const imageTileData = new Map<string, ImageTileData[]>();
    const imageSet = this.imagesJson().img;

    this.imagesJson().directories.forEach((folder) => {
      const imageTilesForThisFolder = imageSet[folder].map((image: GalleryImageData) => {
        return {
          ...image,
          placeholder_src: env.imageCdnUrl + image.placeholder_src,
          img_src: env.imageCdnUrl + image.img_src,
          onClick: () => this.onImageTileClick(env.imageCdnUrl + image.img_src),
        } as ImageTileData;
      });
      imageTileData.set(folder, imageTilesForThisFolder);
    });
    return imageTileData;
  });

  public currentImageFolder: string | undefined;
  public currentImageSourceUrl: string;

  public isModalOpen: boolean = false;

  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly titleService = inject(Title);

  constructor() {
    this.parseImageDataSet();
  }

  ngOnInit() {
    this.titleService.setTitle('Gallery');

    this.activatedRoute.queryParams.subscribe((params) => {
      const { folder } = params as GalleryRouteQueryParams;
      if (folder) {
        this.currentImageFolder = folder;
        this.titleService.setTitle(this.formatFolderName(folder) + ' | Gallery');
      } else {
        this.currentImageFolder = undefined;
        this.titleService.setTitle('Gallery');
      }
    });
  }

  private parseImageDataSet(): void {}

  private onImageTileClick(fullResolutionImageSource: string): void {
    this.currentImageSourceUrl = fullResolutionImageSource;
    this.imageViewerModal.openModal();
  }

  public formatFolderName(folderName: string): string {
    const noSpecialChar = folderName.replace(/[^a-zA-Z0-9]/g, ' ');
    if (noSpecialChar.length < 1) {
      return noSpecialChar;
    }
    return noSpecialChar.charAt(0).toUpperCase() + noSpecialChar.slice(1);
  }
}
