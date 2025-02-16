import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Backdrop } from '../components/backdrop/backdrop';
import { ImageTileComponent } from '../components/image-tile/image-tile.component';
import { ImageViewerModalComponent } from '../components/image-viewer-modal/image-viewer-modal.component';
import { WalkingNoiseBackdrop } from '../components/backdrop/WalkingNosieBackdrop';
import { GalleryDirectory, GalleryImageData, GalleryRouteQueryParams } from '../shapes/gallery';
import { BackdropComponent } from '../components/backdrop/backdrop.component';
import { BannerComponent } from '../components/banner/banner.component';
import { DropdownItemData } from '../shapes/dropdown';
import { DropdownMenuComponent } from '../components/dropdown-menu/dropdown-menu.component';
import { GalleryService } from '../services/gallery.service';

@Component({
  selector: 'x-gallery',
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.scss'],
  imports: [
    BackdropComponent,
    BannerComponent,
    DropdownMenuComponent,
    ImageTileComponent,
    ImageViewerModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryComponent implements OnInit {
  public imageViewerModal = viewChild.required(ImageViewerModalComponent);
  public bgAnimation = signal<Backdrop>(new WalkingNoiseBackdrop());
  public isModalOpen = signal<boolean>(false);
  public currentDirectory = signal<GalleryDirectory | undefined>(undefined);

  public imageSelectedForModal = signal<GalleryImageData | undefined>(undefined);

  private readonly destroyRef = inject(DestroyRef);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly router = inject(Router);
  public readonly galleryService = inject(GalleryService);

  ngOnInit() {
    this.titleService.setTitle('Gallery');

    this.activatedRoute.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const { folder } = params as GalleryRouteQueryParams;
        if (!folder) {
          this.currentDirectory.set(undefined);
          return;
        }

        const folderData = this.galleryService
          .galleryFolderDropownItems()
          .find((item) => item.key === folder)!;

        this.currentDirectory.set({
          path: folder,
          label: folderData.label,
        });

        this.titleService.setTitle(folderData.label + ' | Gallery');
      });
  }

  public onFolderSelectionChange(selectedItem: DropdownItemData | undefined) {
    if (!selectedItem) {
      return;
    }
    this.router.navigate([selectedItem.url], { queryParams: selectedItem.queryParams });
  }

  public onImageTileClick(selectedImage: GalleryImageData): void {
    this.imageSelectedForModal.set(selectedImage);
    this.imageViewerModal().openModal();
  }
}
