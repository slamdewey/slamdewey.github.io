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

const HELLOS: string[] = [
  'hello',
  'hi',
  'howdy',
  'hey',
  'yo',
  'sup',
  'salutations',
  'ahoy',
  'welcome',
  'beep boop',
  'greetings, user',
  '👋',
];

const GREETING_MESSAGES: string[] = [
  'thanks for visiting',
  'enjoy your stay',
  "how'd you end up here?",
  'stay a while',
  'thanks for checking in',
  "congratulations, you've made it",
  'do you come here often?',
  'there is nothing suspicious here',
  "now that you're here, you can never leave",
  "what's that behind you?",
  '404: greeting not found',
  'I can see your browser history',
  'this site is gluten free',
  "if you read this, you're paying too much attention",
  'this is totally not a trap',
  'this is a test of the emergency broadcast system',
  'this is the right place',
  '<greeting-message />',
  'the adventure begins over there',
  'this message could have been funny',
  'mind the gap',
  'this website exists',
  'you are now slightly older',
  'please enjoy this free welcome message',
  'set the bar a little lower',
  'this message is intentionally meaningless',
  'was it worth the wait?',
  "this isn't the sign you were looking for",
  'this site runs on 100% recycled electrons',
  "you're only one click away from closing your browser",
  'your presence has been detected',
  'this is as real as it gets',
  'the website is awaiting your input',
  'there will be a quiz at the end',
  'photons are going into your eyes',
  '🛸😯👽📡✨👾',
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
