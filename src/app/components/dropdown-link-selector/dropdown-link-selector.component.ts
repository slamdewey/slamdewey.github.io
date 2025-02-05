import {
  Component,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  viewChild,
  ChangeDetectionStrategy,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DropdownItemData } from 'src/app/shapes/dropdown';

@Component({
  selector: 'x-dropdown-link-selector',
  templateUrl: './dropdown-link-selector.component.html',
  styleUrls: ['./dropdown-link-selector.component.scss'],
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropdownLinkSelectorComponent implements AfterViewInit, OnDestroy {
  public placeholderText = input.required<string>();
  public items = input.required<DropdownItemData[]>();

  public container = viewChild.required<ElementRef>('container');
  private resizeObserver: ResizeObserver;
  public isOverflowing = signal<boolean>(false);

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(this.checkForOverflow.bind(this));
    this.resizeObserver.observe(document.documentElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver.disconnect();
  }

  checkForOverflow() {
    const nativeElement = this.container().nativeElement;
    const rect = nativeElement.getBoundingClientRect();
    const clientHeight = window.innerHeight || document.documentElement.clientHeight;
    const REM = parseFloat(getComputedStyle(document.documentElement).fontSize);
    // our items are 4 REM tall
    const spaceRequired = 4 * REM * this.items().length;
    return this.isOverflowing.set(spaceRequired + rect.bottom > clientHeight);
  }
}
