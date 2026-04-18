import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BackdropComponent } from '@components/backdrop/backdrop.component';
import { MapTextureBackdrop } from '../../rendering/map-texture-backdrop';

@Component({
  selector: 'x-stage-demo',
  templateUrl: './stage-demo.component.html',
  styleUrls: ['./stage-demo.component.scss'],
  imports: [BackdropComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StageDemoComponent {
  backdrop = input.required<MapTextureBackdrop>();
  caption = input<string>('');
}
