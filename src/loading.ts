/** Keep visual loading feedback and assistive technology in sync. */
export function setBusy(element: HTMLElement, busy: boolean) {
  element.ariaBusy = String(busy);
}
