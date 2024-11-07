import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FaviconService } from './services/favicon.service';
import { NavigationComponent } from './components/navigation/navigation.component';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
  imports: [NavigationComponent, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  constructor(readonly faviconService: FaviconService) {}
}
