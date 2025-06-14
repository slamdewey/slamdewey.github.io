import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { GalleryImageData } from 'src/app/lib/gallery';

@Component({
  selector: 'x-image-tile',
  templateUrl: './image-tile.component.html',
  styleUrls: ['./image-tile.component.scss'],
  imports: [SkeletonLoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageTileComponent {
  public imageData = input.required<GalleryImageData>();
  public isLoaded = signal<boolean>(false);

  public shouldDisplaySkeletonLoader = signal<boolean>(true);

  public onClick = output<GalleryImageData>();

  public onImageLoad() {
    this.isLoaded.set(true);
    this.shouldDisplaySkeletonLoader.set(false);
  }
}
