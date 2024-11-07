import { ChangeDetectionStrategy, Component, input, OnInit } from '@angular/core';

export type BannerVariant = 'basic' | 'error' | 'warning' | 'success';

@Component({
  selector: 'x-banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BannerComponent implements OnInit {
  public variant = input.required<BannerVariant>();

  constructor() {}

  ngOnInit(): void {}
}
