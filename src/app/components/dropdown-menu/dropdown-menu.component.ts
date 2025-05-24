import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DropdownItemData } from 'src/app/lib/dropdown';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatSelectChange, MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';

@Component({
  selector: 'x-dropdown-menu',
  templateUrl: './dropdown-menu.component.html',
  styleUrls: ['./dropdown-menu.component.scss'],
  imports: [MatFormFieldModule, MatSelectModule, MatInputModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropdownMenuComponent {
  public placeholderLabel = input<string>('Select an option');
  public initialValue = input<string | undefined>();
  public items = input.required<DropdownItemData[]>();

  public onItemSelect = output<DropdownItemData | undefined>();

  public onSelectionChange(event: MatSelectChange) {
    this.onItemSelect.emit(this.items().find((item) => item.label === event.value));
  }
}
