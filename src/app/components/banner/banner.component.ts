import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'x-banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BannerComponent {}
