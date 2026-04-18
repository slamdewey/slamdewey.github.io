import { ChangeDetectionStrategy, Component, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSliderModule } from '@angular/material/slider';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { NoiseVariables, ClimateVariables, DEFAULT_NOISE, DEFAULT_CLIMATE } from '../../lib/types';

@Component({
  selector: 'x-param-controls',
  templateUrl: './param-controls.component.html',
  styleUrls: ['./param-controls.component.scss'],
  imports: [FormsModule, MatSliderModule, MatInputModule, MatFormFieldModule, MatButtonModule, MatExpansionModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParamControlsComponent {
  noise = model<NoiseVariables>({ ...DEFAULT_NOISE });
  climate = model<ClimateVariables>({ ...DEFAULT_CLIMATE });
  mapWidth = model<number>(512);
  mapHeight = model<number>(256);

  regenerate = output<void>();

  randomizeSeed(): void {
    this.noise.update((n) => ({ ...n, seed: Math.floor(Math.random() * 2147483647) }));
  }

  updateNoise(key: keyof NoiseVariables, value: number): void {
    this.noise.update((n) => ({ ...n, [key]: value }));
  }

  updateClimate(key: keyof ClimateVariables, value: number): void {
    this.climate.update((c) => ({ ...c, [key]: value }));
  }

  onRegenerate(): void {
    this.regenerate.emit();
  }
}
