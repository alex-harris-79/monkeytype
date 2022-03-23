type SubscribeFunction = () => void;

const subscribers: SubscribeFunction[] = [];

export function subscribe(fn: SubscribeFunction): void {
  subscribers.push(fn);
}

export function dispatch(): void {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error("Page change event subscriber threw an error");
      console.error(e);
    }
  });
}
