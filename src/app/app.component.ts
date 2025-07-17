import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavigationComponent } from './components/navigation/navigation.component';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'x-app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  imports: [NavigationComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
