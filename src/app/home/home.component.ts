import {
  Component,
  ViewEncapsulation,
  OnInit,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Backdrop } from '../components/backdrop/backdrop';
import { UVColorCycleBackground } from '../components/backdrop/UVColorCycleBackground';
import { BackdropComponent } from '../components/backdrop/backdrop.component';
import { Title } from '@angular/platform-browser';

const HELLOS: string[] = ['hello', 'hi', 'howdy', 'hey'];

const GREETING_MESSAGES: string[] = [
  'thanks for visiting',
  'enjoy your stay',
  "how'd you end up here?",
  'welcome to my site',
  'stay a while',
  'thanks for checking in',
  "congratulations, you've made it",
  'welcome to the other side',
  'do you come here often?',
  'there is nothing suspicious here',
  "now that you're here, you can never leave",
  "what's that behind you?",
];

function getRandomIndex(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

@Component({
    selector: 'x-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    encapsulation: ViewEncapsulation.None,
    imports: [BackdropComponent],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent implements OnInit {
  public bgAnimation: Backdrop = new UVColorCycleBackground();
  public hello: string = getRandomIndex(HELLOS);
  public greeting: string = getRandomIndex(GREETING_MESSAGES);

  private readonly titleService = inject(Title);

  ngOnInit(): void {
    this.titleService.setTitle('Jared.Systems');
  }
}
