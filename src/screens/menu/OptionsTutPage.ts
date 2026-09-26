import { OptionsPage } from "./OptionsPage";

export class OptionsTutPage extends OptionsPage {
  protected override readonly frame = "optionsTut";
  protected override get showBack(): boolean {
    return true;
  }
}
