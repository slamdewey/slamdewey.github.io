import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
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
import { GalleryDirectory, GalleryImageData, GalleryRouteQueryParams } from '../lib/gallery';
import { BackdropComponent } from '../components/backdrop/backdrop.component';
import { BannerComponent } from '../components/banner/banner.component';
import { DropdownItemData } from '../lib/dropdown';
import { DropdownMenuComponent } from '../components/dropdown-menu/dropdown-menu.component';
import { GalleryService } from '../services/gallery.service';

@Component({
  selector: 'x-gallery',
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.scss'],
  imports: [BackdropComponent, BannerComponent, DropdownMenuComponent, ImageTileComponent, ImageViewerModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryComponent implements OnInit {
  public imageViewerModal = viewChild.required(ImageViewerModalComponent);
  public bgAnimation = signal<Backdrop>(new WalkingNoiseBackdrop());
  public isModalOpen = signal<boolean>(false);
  public imageSelectedForModal = signal<GalleryImageData | undefined>(undefined);

  private readonly folder = signal<string | undefined>(undefined);
  private readonly destroyRef = inject(DestroyRef);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly titleService = inject(Title);
  private readonly router = inject(Router);
  public readonly galleryService = inject(GalleryService);

  public currentDirectory = computed<GalleryDirectory | undefined>(() => {
    const folder = this.folder();
    if (!folder) return undefined;
    const folderData = this.galleryService.galleryFolderDropownItems().find((item) => item.key === folder);
    if (!folderData) return undefined;
    return { path: folder, label: folderData.label };
  });

  constructor() {
    effect(() => {
      const dir = this.currentDirectory();
      this.titleService.setTitle(dir ? dir.label + ' | Gallery' : 'Gallery');
    });
  }

  ngOnInit() {
    this.activatedRoute.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const { folder } = params as GalleryRouteQueryParams;
      this.folder.set(folder);
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
