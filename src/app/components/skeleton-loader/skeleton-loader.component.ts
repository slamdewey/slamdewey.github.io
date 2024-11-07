import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'x-skeleton-loader',
  templateUrl: './skeleton-loader.component.html',
  styleUrl: './skeleton-loader.component.scss',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkeletonLoaderComponent {
  public loadingMessage = input<string>('');
}
