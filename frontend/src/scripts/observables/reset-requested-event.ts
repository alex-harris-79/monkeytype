type ResetRequestedFunction = () => void;

const subscribers: ResetRequestedFunction[] = [];

export function subscribe(fn: ResetRequestedFunction): void {
  subscribers.push(fn);
}

export function dispatch(): void {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error("Reset requested event subscriber threw an error");
      console.error(e);
    }
  });
}
