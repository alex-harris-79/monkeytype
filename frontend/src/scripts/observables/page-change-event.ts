import Page from "../pages/page";

type SubscribeFunction = (previousPage: Page, newPage: Page) => void;

const subscribers: SubscribeFunction[] = [];

export function subscribe(fn: SubscribeFunction): void {
  subscribers.push(fn);
}

export function dispatch(previousPage: Page, newPage: Page): void {
  subscribers.forEach((fn) => {
    try {
      fn(previousPage, newPage);
    } catch (e) {
      console.error("Page change event subscriber threw an error");
      console.error(e);
    }
  });
}
